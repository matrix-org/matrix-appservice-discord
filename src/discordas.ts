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
import { Appservice, IAppserviceRegistration, ConsoleLogger, LogService } from "matrix-bot-sdk";
import * as yaml from "js-yaml";
import * as fs from "fs";
import { DiscordBridgeConfig } from "./config";
import { DiscordBot } from "./bot";
import { DiscordStore } from "./store";
import { Log } from "./log";
import "source-map-support/register";
import * as cliArgs from "command-line-args";
import * as usage from "command-line-usage";
import * as uuid from "uuid/v4";
import { IMatrixEvent } from "./matrixtypes";

const log = new Log("DiscordAS");

const commandOptions = [
    { name: 'config', alias: 'c', type: String },
    { name: 'url', alias: 'u', type: String },
    { name: 'port', alias: 'p', type: Number },
    { name: 'file', alias: 'f', type: String },
    { name: 'generate-registration', alias: 'r', type: Boolean },
    { name: 'help', alias: 'h', type: Boolean },
];

function generateRegistration(opts, registrationPath)  {
    if (!opts.url) {
        throw Error("'url' not given in command line opts, cannot generate registration file");
    }
    const reg = {
        id: "discord-bridge",
        as_token: uuid(),
        hs_token: uuid(),
        sender_localpart: "_discord_bot",
        namespaces: {
            users: [
                {
                    exclusive: true,
                    regex: "@_discord_.*",
                },
            ],
            rooms: [ ],
            aliases: [
                {
                    exclusive: true,
                    regex: "#_discord_.*",
                },
            ],
        },
        rate_limited: false,
        url: opts.url,
        protocols: ["discord"],
    } as IAppserviceRegistration;
    fs.writeFileSync(registrationPath, yaml.safeDump(reg));
}

async function run() {
    const opts = cliArgs(commandOptions);
    if (opts.help) {
        /* tslint:disable:no-console */
        console.log(usage([
            {
                content: "The matrix appservice for discord",
                header: "Matrix Discord Bridge",
            },
            {
                header: "Options",
                optionList: commandOptions,
            },
        ]));
        process.exit(0);
    }
    // Parse config 
    const configPath = opts.config || "config.yaml";
    const registrationPath = opts.file || "discord-registration.yaml";

    if (opts["generate-registration"]) {
        if (fs.existsSync(registrationPath)) {
            throw Error("Not writing new registration file, file already exists");
        }
        generateRegistration(opts, registrationPath);
        return;
    }

    const config = new DiscordBridgeConfig();
    const port = opts.port || config.bridge.port;
    if (!port) {
        throw Error("Port not given in command line or config file");
    }
    config.ApplyConfig(yaml.safeLoad(fs.readFileSync(configPath, "utf8")));
    Log.Configure(config.logging);
    const registration = yaml.safeLoad(fs.readFileSync(registrationPath, "utf8")) as IAppserviceRegistration;
    const appservice = new Appservice({
        registration,
        port,
        bindAddress: config.bridge.bindAddress || "0.0.0.0",
        homeserverName: config.bridge.domain,
        homeserverUrl: config.bridge.homeserverUrl,
    });
    const logMap = new Map<string, Log>();
    const logFunc = (level: string, module: string, args: any[]) => {
        if (!Array.isArray(args)) {
            args = [args];
        }
        if (args.find((s) => s.includes && s.includes("M_USER_IN_USE"))) {
            // Spammy logs begon
            return;
        }
        const mod =  "bot-sdk" + module;
        let logger = logMap.get(mod);
        if (!logger) {
            logger = new Log(mod);
            logMap.set(mod, logger);
        }
        logger[level](args);
    };

    LogService.setLogger({
        info: (mod: string, args: any[]) => logFunc("info", mod, args),
        debug: (mod: string, args: any[]) => logFunc("silly", mod, args),
        warn: (mod: string, args: any[]) => logFunc("warn", mod, args),
        error: (mod: string, args: any[]) => logFunc("error", mod, args),
    });

    console.log((appservice as any).storage);

    const botUserId = `@${registration.sender_localpart}:${config.bridge.domain}`


    const store = new DiscordStore(config.database);

    if (config.database.roomStorePath) {
        log.warn("[DEPRECATED] The room store is now part of the SQL database."
               + "The config option roomStorePath no longer has any use.");
    }

    if (config.database.userStorePath) {
        log.warn("[DEPRECATED] The user store is now part of the SQL database."
               + "The config option userStorePath no longer has any use.");
    }


    try {
        await store.init();
    } catch (ex) {
        log.error("Failed to init database. Exiting.", ex);
        process.exit(1);
    }

    const discordbot = new DiscordBot(botUserId, config, appservice, store);
    const roomhandler = discordbot.RoomHandler;
    const eventProcessor = discordbot.MxEventProcessor;


    appservice.on("query.room", async (roomAlias: string, createRoom: (opts: any) => Promise<void>) => {
        try {
            const createRoomOpts = await roomhandler.OnAliasQuery(roomAlias);
            await createRoom(createRoomOpts);
            await roomhandler.OnAliasQueried(roomAlias, createRoomOpts["__roomId"]);
        } catch (err) { log.error("Exception thrown while handling \"query.room\" event", err); }
    });

    appservice.on("room.event", async (room_id: string, event: IMatrixEvent) => {
        try {
            const entries = await store.roomStore.getEntriesByMatrixId(room_id);
            eventProcessor.OnEvent(event, entries);
        } catch (err) { log.error("Exception thrown while handling \"room.event\" event", err); }
    });

    await appservice.begin();
    log.info(`Started listening on port ${port}`);

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

run().catch((err) => {
    log.error("A fatal error occurred during startup:", err);
    process.exit(1);
})