/*
Copyright 2017 - 2019 matrix-appservice-discord

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { Cli, Bridge, AppServiceRegistration, ClientFactory } from "matrix-appservice-bridge";
import * as Bluebird from "bluebird";
import * as yaml from "js-yaml";
import * as fs from "fs";
import { DiscordBridgeConfig } from "./config";
import { DiscordBot } from "./bot";
import { DiscordStore } from "./store";
import { Log } from "./log";
import "source-map-support/register";

const log = new Log("DiscordAS");

const cli = new Cli({
    bridgeConfig: {
        affectsRegistration: true,
        schema: "./config/config.schema.yaml",
    },
    generateRegistration,
    registrationPath: "discord-registration.yaml",
    run,
});

try {
    cli.run();
} catch (err) {
    log.error("Failed to start bridge.");
    log.error(err);
}

function generateRegistration(reg, callback)  {
    reg.setId(AppServiceRegistration.generateToken());
    reg.setHomeserverToken(AppServiceRegistration.generateToken());
    reg.setAppServiceToken(AppServiceRegistration.generateToken());
    reg.setSenderLocalpart("_discord_bot");
    reg.addRegexPattern("users", "@_discord_.*", true);
    reg.addRegexPattern("aliases", "#_discord_.*", true);
    reg.setRateLimited(false);
    reg.setProtocols(["discord"]);
    callback(reg);
}

// tslint:disable-next-line no-any
type callbackFn = (...args: any[]) => Promise<any>;

async function run(port: number, fileConfig: DiscordBridgeConfig) {
    const config = new DiscordBridgeConfig();
    config.ApplyConfig(fileConfig);
    Log.Configure(config.logging);
    log.info("Starting Discord AS");
    const yamlConfig = yaml.safeLoad(fs.readFileSync(cli.opts.registrationPath, "utf8"));
    const registration = AppServiceRegistration.fromObject(yamlConfig);
    if (registration === null) {
        throw new Error("Failed to parse registration file");
    }

    const botUserId = `@${registration.sender_localpart}:${config.bridge.domain}`;
    const clientFactory = new ClientFactory({
        appServiceUserId: botUserId,
        token: registration.as_token,
        url: config.bridge.homeserverUrl,
    });
    const store = new DiscordStore(config.database);

    const callbacks: { [id: string]: callbackFn; } = {};

    const bridge = new Bridge({
        clientFactory,
        controller: {
            // onUserQuery: userQuery,
            onAliasQueried: async (alias: string, roomId: string) => {
                try {
                    return await callbacks.onAliasQueried(alias, roomId);
                } catch (err) { log.error("Exception thrown while handling \"onAliasQueried\" event", err); }
            },
            onAliasQuery: async (alias: string, aliasLocalpart: string) => {
                try {
                    return await callbacks.onAliasQuery(alias, aliasLocalpart);
                } catch (err) { log.error("Exception thrown while handling \"onAliasQuery\" event", err); }
            },
            onEvent: async (request) => {
                try {
                    // Build our own context.
                    if (!store.roomStore) {
                        log.warn("Discord store not ready yet, dropping message");
                        return;
                    }
                    const roomId = request.getData().room_id;
                    let context = {};
                    if (roomId) {
                        const entries  = await store.roomStore.getEntriesByMatrixId(request.getData().room_id);
                        context = {
                            rooms: entries[0],
                        };
                    }
                    await request.outcomeFrom(Bluebird.resolve(callbacks.OnEvent(request, context)));
                } catch (err) {
                    log.error("Exception thrown while handling \"onEvent\" event", err);
                    await request.outcomeFrom(Bluebird.reject("Failed to handle"));
                }
            },
            onLog: (line, isError) => {
                log.verbose("matrix-appservice-bridge", line);
            },
            thirdPartyLookup: async () => {
                try {
                    return await callbacks.thirdPartyLookup();
                } catch (err) {
                    log.error("Exception thrown while handling \"thirdPartyLookup\" event", err);
                }
            },
        },
        disableContext: true,
        domain: config.bridge.domain,
        homeserverUrl: config.bridge.homeserverUrl,
        intentOptions: {
            clients: {
                dontJoin: true, // handled manually
            },
        },
        // To avoid out of order message sending.
        queue: {
            perRequest: true,
            type: "per_room",
        },
        registration,
        userStore: config.database.userStorePath,
    });

    if (config.database.roomStorePath) {
        log.warn("[DEPRECATED] The room store is now part of the SQL database."
               + "The config option roomStorePath no longer has any use.");
    }

    if (config.database.userStorePath) {
        log.warn("[DEPRECATED] The user store is now part of the SQL database."
               + "The config option userStorePath no longer has any use.");
    }

    await bridge.run(port, config);
    log.info(`Started listening on port ${port}`);

    try {
        await store.init(undefined, bridge.getRoomStore(), bridge.getUserStore());
    } catch (ex) {
        log.error("Failed to init database. Exiting.", ex);
        process.exit(1);
    }

    const discordbot = new DiscordBot(botUserId, config, bridge, store);
    const roomhandler = discordbot.RoomHandler;

    try {
        callbacks.onAliasQueried = roomhandler.OnAliasQueried.bind(roomhandler);
        callbacks.onAliasQuery = roomhandler.OnAliasQuery.bind(roomhandler);
        callbacks.onEvent = roomhandler.OnEvent.bind(roomhandler);
        callbacks.thirdPartyLookup = async () => {
            return roomhandler.ThirdPartyLookup;
        };
    } catch (err) {
        log.error("Failed to register callbacks. Exiting.", err);
        process.exit(1);
    }

    log.info("Initing bridge");

    try {
        await discordbot.init();
        await discordbot.run();
        log.info("Discordbot started successfully");
    } catch (err) {
        log.error(err);
        log.error("Failure during startup. Exiting");
        process.exit(1);
    }
}
