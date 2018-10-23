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
const log = new Log("AddRoomsToDirectory");
const optionDefinitions = [
    {
        name: "help",
        alias: "h",
        type: Boolean,
        description: "Display this usage guide.",
    },
    {
      name: "config",
      alias: "c",
      type: String,
      defaultValue: "config.yaml",
      description: "The AS config file.",
      typeLabel: "<config.yaml>",
    },
    {
        name: "store",
        alias: "s",
        type: String,
        defaultValue: "room-store.db",
        description: "The location of the room store.",
    },
];

const options = args(optionDefinitions);

if (options.help) {
    /* tslint:disable:no-console */
    console.log(usage([
    {
        header: "Add rooms to directory",
        content: "A tool to set all the bridged rooms to visible in the directory."},
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
    homeserverUrl: true,
    registration: true,
    domain: "rubbish",
    controller: {
        onEvent: () => { },
    },
    roomStore: options.store,
});

bridge.loadDatabases().catch((e) => {
    log.error("AddRoom", `Failed to load database`, e);
}).then(() => {
    return bridge.getRoomStore().getEntriesByRemoteRoomData({
        discord_type: "text",
    });
}).then((rooms) => {
    rooms = rooms.filter((r) => r.remote.get("plumbed") !== true );
    const client = clientFactory.getClientAs();
    log.info("AddRoom", `Got ${rooms.length} rooms to set`);
    rooms.forEach((room) => {
        const guild = room.remote.get("discord_guild");
        const roomId = room.matrix.getId();
        client.setRoomDirectoryVisibilityAppService(
            guild,
            roomId,
            "public",
        ).then(() => {
            log.info("AddRoom", `Set ${roomId} to visible in ${guild}'s directory`);
        }).catch((e) => {
            log.error("AddRoom", `Failed to set ${roomId} to visible in ${guild}'s directory`, e);
        });
    });
}).catch((e) => {
    log.error("AddRoom", `Failed to run script`, e);
});
