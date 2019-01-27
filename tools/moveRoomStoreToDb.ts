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

/* tslint:disable:no-console */
/**
 * Allows you to become an admin for a room the bot is in control of.
 */

import { ClientFactory, Bridge } from "matrix-appservice-bridge";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as args from "command-line-args";
import * as usage from "command-line-usage";
import { DiscordBridgeConfig } from "../src/config";
import { Log } from "../src/log";
import { Util } from "../src/util";
import { RemoteStoreRoom, MatrixStoreRoom } from "../src/db/roomstore";
import { DiscordStore } from "../src/store";
const log = new Log("MoveRoomStoreToDb");

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
    {
        alias: "s",
        defaultValue: "room-store.db",
        description: "The location of the room store.",
        name: "store",
        type: String,
    },
];

const options = args(optionDefinitions);

if (options.help) {
    /* tslint:disable:no-console */
    console.log(usage([
    {
        content: "A tool to move all room store entries to the database.",
        header: "Add rooms to directory",
    },
    {
        header: "Options",
        optionList: optionDefinitions,
    },
    ]));
    process.exit(0);
}
const config: DiscordBridgeConfig = yaml.safeLoad(fs.readFileSync(options.config, "utf8")) as DiscordBridgeConfig;

const bridge = new Bridge({
    controller: {
        onEvent: () => { },
    },
    domain: "rubbish",
    homeserverUrl: true,
    registration: true,
    roomStore: options.store,
});

async function run() {
    await bridge.loadDatabases();
    const store = new DiscordStore(config.database);
    await store.init();
    const rooms = await bridge.getRoomStore().select({});
    // Matrix room only entrys are useless.
    const entrys = rooms.filter((r) => r.remote);
    entrys.forEach((e) => {
        const remote = new RemoteStoreRoom(e.remote_id, e.remote);
        const matrix = new MatrixStoreRoom(e.matrix_id);
        store.roomStore.linkRooms(matrix, remote).then(() => {
            log.info(`Migrated ${matrix.roomId}`);
        }).catch((err) => {
            log.error(`Failed to link ${matrix.roomId}: `, err);
        });
    });
}

run().catch((e) => {
    log.error(`Failed to run script`, e);
});
