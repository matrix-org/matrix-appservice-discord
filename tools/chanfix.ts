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

import { AppServiceRegistration, ClientFactory, Bridge, Intent } from "matrix-appservice-bridge";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as args from "command-line-args";
import * as usage from "command-line-usage";
import { ChannelSyncroniser } from "../src/channelsyncroniser";
import { DiscordBridgeConfig } from "../src/config";
import { DiscordBot } from "../src/bot";
import { DiscordStore } from "../src/store";
import { Provisioner } from "../src/provisioner";
import { Log } from "../src/log";
import { Util } from "../src/util";

const log = new Log("ChanFix");

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
        content: "A tool to fix channels of rooms already bridged " +
        "to matrix, to make sure their names, icons etc. are correctly.",
        header: "Fix bridged channels",
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
    bridge._botClient = bridge._clientFactory.getClientAs();
    bridge._botIntent = new Intent(bridge._botClient, bridge._botClient, { registered: true });
    await discordbot.ClientFactory.init();
    const client = await discordbot.ClientFactory.getClient();

    // first set update_icon to true if needed
    const mxRoomEntries = await bridge.getRoomStore().getEntriesByRemoteRoomData({
        update_name: true,
        update_topic: true,
    });

    const promiseList: Promise<void>[] = [];
    mxRoomEntries.forEach((entry) => {
        if (entry.remote.get("plumbed")) {
            return; // skipping plumbed rooms
        }
        const updateIcon = entry.remote.get("update_icon");
        if (updateIcon !== undefined && updateIcon !== null) {
            return; // skipping because something was set manually
        }
        entry.remote.set("update_icon", true);
        promiseList.push(bridge.getRoomStore().upsertEntry(entry));
    });
    await Promise.all(promiseList);

    // now it is time to actually run the updates
    const promiseList2: Promise<void>[] = [];

    let curDelay = config.limits.roomGhostJoinDelay; // we'll just re-use this
    client.guilds.forEach((guild) => {
        promiseList2.push((async () => {
            await Util.DelayedPromise(curDelay);
            try {
                await discordbot.ChannelSyncroniser.OnGuildUpdate(guild, true);
            } catch (err) {
                log.warn(`Couldn't update rooms of guild ${guild.id}`, err);
            }
        })());
        curDelay += config.limits.roomGhostJoinDelay;
    });
    try {
        await Promise.all(promiseList2);
    } catch (err) {
        log.error(err);
    }
    process.exit(0);
}

run(); // tslint:disable-line no-floating-promises
