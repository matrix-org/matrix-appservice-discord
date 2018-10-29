/* tslint:disable:no-console */
/**
 * Allows you to become an admin for a room the bot is in control of.
 */

import { AppServiceRegistration, ClientFactory, Bridge } from "matrix-appservice-bridge";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as args from "command-line-args";
import * as usage from "command-line-usage";
import { DiscordBridgeConfig } from "../src/config";
import { Log } from "../src/log";
import { Util } from "../src/util";
const log = new Log("AddRoomsToDirectory");
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
        content: "A tool to set all the bridged rooms to visible in the directory.",
        header: "Add rooms to directory",
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
const config: DiscordBridgeConfig = yaml.safeLoad(fs.readFileSync(options.config, "utf8")) as DiscordBridgeConfig;

if (registration === null) {
    throw new Error("Failed to parse registration file");
}

const clientFactory = new ClientFactory({
    appServiceUserId: "@" + registration.sender_localpart + ":" + config.bridge.domain,
    token: registration.as_token,
    url: config.bridge.homeserverUrl,
});

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
    try {
        await bridge.loadDatabases();
    } catch (e) {
        log.error(`Failed to load database`, e);
    }

    let rooms = await bridge.getRoomStore().getEntriesByRemoteRoomData({
        discord_type: "text",
    });
    rooms = rooms.filter((r) => r.remote.get("plumbed") !== true );
    const client = clientFactory.getClientAs();
    log.info(`Got ${rooms.length} rooms to set`);
    try {
        await Util.AsyncForEach(rooms, async (room) => {
            const guild = room.remote.get("discord_guild");
            const roomId = room.matrix.getId();
            try {
                await client.setRoomDirectoryVisibilityAppService(
                    guild,
                    roomId,
                    "public",
                );
                log.info(`Set ${roomId} to visible in ${guild}'s directory`);
            } catch (e) {
                log.error(`Failed to set ${roomId} to visible in ${guild}'s directory`, e);
            }
        });
    } catch (e) {
        log.error(`Failed to run script`, e);
    }
}

run(); // tslint:disable-line no-floating-promises
