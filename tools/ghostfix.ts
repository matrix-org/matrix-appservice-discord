/*
Copyright 2018 matrix-appservice-discord

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

import { AppServiceRegistration, ClientFactory, Bridge } from "matrix-appservice-bridge";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as args from "command-line-args";
import * as usage from "command-line-usage";
import { DiscordBridgeConfig } from "../src/config";
import { Log } from "../src/log";
import { Util } from "../src/util";
import { DiscordBot } from "../src/bot";
import { DiscordStore } from "../src/store";

const log = new Log("GhostFix");

// Note: The schedule must not have duplicate values to avoid problems in positioning.
/* tslint:disable:no-magic-numbers */ // Disabled because it complains about the values in the array
const JOIN_ROOM_SCHEDULE = [
    0,              // Right away
    1000,           // 1 second
    30000,          // 30 seconds
    300000,         // 5 minutes
    900000,         // 15 minutes
];
/* tslint:enable:no-magic-numbers */

const optionDefinitions = [
    {
        alias: "h",
        description: "Display this usage guide.",
        name: "help",
        type: Boolean,
    },
    {
        alias: "c",
        defaultValue: "config.yaml",
        description: "The AS config file.",
        name: "config",
        type: String,
        typeLabel: "<config.yaml>",
    },
];

const options = args(optionDefinitions);

if (options.help) {
    /* tslint:disable:no-console */
    console.log(usage([
    {
        content: "A tool to fix usernames of ghosts already in " +
        "matrix rooms, to make sure they represent the correct discord usernames.",
        header: "Fix usernames of joined ghosts",
    },
    {
        header: "Options",
        optionList: optionDefinitions,
    },
    ]));
    process.exit(0);
}

const yamlConfig = yaml.safeLoad(fs.readFileSync("./discord-registration.yaml", "utf8"));
const registration = AppServiceRegistration.fromObject(yamlConfig);
const config = new DiscordBridgeConfig();
config.applyConfig(yaml.safeLoad(fs.readFileSync(options.config, "utf8")) as DiscordBridgeConfig);
config.applyEnvironmentOverrides(process.env);

if (registration === null) {
    throw new Error("Failed to parse registration file");
}

const botUserId = `@${registration.sender_localpart}:${config.bridge.domain}`;
const clientFactory = new ClientFactory({
    appServiceUserId: botUserId,
    token: registration.as_token,
    url: config.bridge.homeserverUrl,
});

const bridge = new Bridge({
    clientFactory,
    controller: {
        onEvent: () => { },
    },
    domain: config.bridge.domain,
    homeserverUrl: config.bridge.homeserverUrl,
    intentOptions: {
        clients: {
            dontJoin: true, // handled manually
      },
    },
    registration,
    roomStore: config.database.roomStorePath,
    userStore: config.database.userStorePath,
});

async function run() {
    await bridge.loadDatabases();
    const store = new DiscordStore(config.database);
    await store.init(undefined, bridge.getRoomStore());
    const discordbot = new DiscordBot(botUserId, config, bridge, store);
    await discordbot.init();
    bridge._clientFactory = clientFactory;
    const client = await discordbot.ClientFactory.getClient();

    const promiseList: Promise<void>[] = [];
    let curDelay = config.limits.roomGhostJoinDelay;
    try {
        client.guilds.forEach((guild) => {
            guild.members.forEach((member) => {
                if (member.id === client.user.id) {
                    return;
                }
                promiseList.push((async () => {
                    await Util.DelayedPromise(curDelay);
                    let currentSchedule = JOIN_ROOM_SCHEDULE[0];
                    const doJoin = async () => {
                        await Util.DelayedPromise(currentSchedule);
                        await discordbot.UserSyncroniser.OnUpdateGuildMember(member, true, false);
                    };
                    const errorHandler = async (err) => {
                        log.error(`Error joining rooms for ${member.id}`);
                        log.error(err);
                        const idx = JOIN_ROOM_SCHEDULE.indexOf(currentSchedule);
                        if (idx === JOIN_ROOM_SCHEDULE.length - 1) {
                            log.warn(`Cannot join rooms for ${member.id}`);
                            throw new Error(err);
                        } else {
                            currentSchedule = JOIN_ROOM_SCHEDULE[idx + 1];
                            try {
                                await doJoin();
                            } catch (e) {
                                await errorHandler(e);
                            }
                        }
                    };
                    try {
                        await doJoin();
                    } catch (e) {
                        await errorHandler(e);
                    }
                })());
                curDelay += config.limits.roomGhostJoinDelay;
            });
        });

        await Promise.all(promiseList);
    } catch (err) {
        log.error(err);
    }
    process.exit(0);
}

run(); // tslint:disable-line no-floating-promises
