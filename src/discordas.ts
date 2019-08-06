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

import {
    AppServiceRegistration,
    Bridge,
    BridgeContext,
    Cli,
    ClientFactory,
    Request,
    thirdPartyLookup,
    unstable,
} from "matrix-appservice-bridge";
import * as yaml from "js-yaml";
import * as fs from "fs";
import { DiscordBridgeConfig } from "./config";
import { DiscordBot } from "./bot";
import { DiscordStore } from "./store";
import { Log } from "./log";
import "source-map-support/register";
import { MetricPeg, PrometheusBridgeMetrics } from "./metrics";
import { IMatrixEvent } from "./matrixtypes";
import { instanceofsome } from "./util";

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

interface IBridgeCallbacks {
    onAliasQueried: (alias: string, roomId: string) => Promise<void>;
    onAliasQuery: (alias: string, aliasLocalpart: string) => Promise<IProvisionedRoom>;
    onEvent: (request: Request, context: BridgeContext) => Promise<void>;
    thirdPartyLookup: thirdPartyLookup;
}

type RemoteRoom = any; // tslint:disable-line no-any

interface IProvisionedRoom {
    creationOpts: Record<string, any>; // tslint:disable-line no-any
    remote?: RemoteRoom;
}

async function run(port: number, fileConfig: DiscordBridgeConfig) {
    const config = new DiscordBridgeConfig();
    config.applyConfig(fileConfig);
    config.applyEnvironmentOverrides(process.env);
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

    let callbacks: IBridgeCallbacks;

    const bridge = new Bridge({
        clientFactory,
        controller: {
            // onUserQuery: userQuery,
            onAliasQueried: async (alias: string, roomId: string): Promise<void> => {
                try {
                    return await callbacks.onAliasQueried(alias, roomId);
                } catch (err) { log.error("Exception thrown while handling \"onAliasQueried\" event", err); }
            },
            onAliasQuery: async (alias: string, aliasLocalpart: string): Promise<IProvisionedRoom|undefined> => {
                try {
                    return await callbacks.onAliasQuery(alias, aliasLocalpart);
                } catch (err) { log.error("Exception thrown while handling \"onAliasQuery\" event", err); }
            },
            onEvent: async (request: Request, _: BridgeContext): Promise<void> => {
                try {
                    const event = request.getData() as IMatrixEvent;
                    const roomId = event.room_id;

                    MetricPeg.get.registerRequest(event.event_id);

                    const context = await buildOwnContext(roomId, store);
                    const callbackResult = callbacks.onEvent(request, context);
                    request.outcomeFrom(callbackResult);
                } catch (err) {
                    logOnEventError(err);
                    request.reject(err);
                } finally {
                    recordRequestOutcome(request);
                }
            },
            onLog: (text: string, isError: boolean): void => {
                if (isError) {
                    log.error("matrix-appservice-bridge", text);
                } else {
                    log.verbose("matrix-appservice-bridge", text);
                }
            },
            thirdPartyLookup: async (): Promise<thirdPartyLookup> => {
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
        networkName: "Discord",
        // To avoid out of order message sending.
        queue: {
            perRequest: true,
            type: "per_room",
        },
        registration,
        // These must be kept for a while yet since we use them for migrations.
        roomStore: config.database.roomStorePath,
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

    if (config.bridge.enableMetrics) {
        log.info("Enabled metrics");
        MetricPeg.set(new PrometheusBridgeMetrics().init(bridge));
    }

    try {
        await store.init(undefined, bridge.getRoomStore(), bridge.getUserStore());
    } catch (ex) {
        log.error("Failed to init database. Exiting.", ex);
        process.exit(1);
    }

    const discordbot = new DiscordBot(botUserId, config, bridge, store);
    const roomhandler = discordbot.RoomHandler;
    const eventProcessor = discordbot.MxEventProcessor;

    try {
        callbacks = {
            onAliasQueried: roomhandler.OnAliasQueried.bind(roomhandler),
            onAliasQuery: roomhandler.OnAliasQuery.bind(roomhandler),
            onEvent: eventProcessor.OnEvent.bind(eventProcessor),
            thirdPartyLookup: async () => {
                return roomhandler.ThirdPartyLookup;
            },
        };
    } catch (err) {
        log.error("Failed to register callbacks. Exiting.", err);
        process.exit(1);
    }

    log.info("Initing bridge");

    try {
        log.info("Initing store.");
        await discordbot.init();
        log.info(`Started listening on port ${port}.`);
        log.info("Initing bot.");
        await discordbot.run();
        log.info("Discordbot started successfully");
    } catch (err) {
        log.error(err);
        log.error("Failure during startup. Exiting");
        process.exit(1);
    }
}

/**
 * Logs an error which occured during event processing.
 *
 * Depending on the error type different log levels are hardcoded.
 */
function logOnEventError(err: Error): void {
    const errTypes = [];
    // const warn = [EventInternalError, EventTooOldError, NotReadyError, …];
    const infoTypes = [];
    const verboseTypes = [unstable.EventUnknownError];

    switch (true) {
        case instanceofsome(err, errTypes): log.error(err);
        case instanceofsome(err, infoTypes): log.info(err);
        case instanceofsome(err, verboseTypes): log.verbose(err);
        default: log.warn(err);
    }
}

/**
 * Records in which way the request was handled.
 */
function recordRequestOutcome(request: Request): void {
    const eventId = request.getData().eventId;
    request.getPromise()
        .then(() =>
            MetricPeg.get.requestOutcome(eventId, false, "success"),
        )
        .catch(unstable.EventNotHandledError, (e) =>
            MetricPeg.get.requestOutcome(eventId, false, "dropped"),
        )
        .catch((e) =>
            MetricPeg.get.requestOutcome(eventId, false, "fail"),
        )
    ;
}

/**
 * Builds a custom BridgeContext with rooms known to the bridge.
 */
async function buildOwnContext(
    roomId: string,
    store: DiscordStore,
): Promise<BridgeContext> {
    if (!store.roomStore) {
        throw new NotReadyError("Discord store not ready yet, will retry later");
    }

    const entries = await store.roomStore.getEntriesByMatrixId(roomId);

    return {
        rooms: entries[0] || {},
        senders: {},
        targets: {},
    };
}

class NotReadyError extends Error {
    public name: string;

    constructor(...params) {
        unstable.defaultMessage(
            params,
            "The bridge was not ready when the message was sent",
        );
        super(...params);
        this.name = "NotReadyError";
    }
}
