/* tslint:disable:no-console */
/**
 * Allows you to become an admin for a room the bot is in control of.
 */

import { AppServiceRegistration, ClientFactory, Intent } from "matrix-appservice-bridge";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as args from "command-line-args";
import * as usage from "command-line-usage";
import { DiscordBridgeConfig } from "../src/config";

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
        alias: "r",
        description: "The roomid to modify",
        name: "roomid",
        type: String,
    },
    {
        alias: "u",
        description: "The userid to give powers",
        name: "userid",
        type: String,
    },
    {
        alias: "p",
        defaultValue: 100,
        description: "The power to set",
        name: "power",
        type: Number,
        typeLabel: "<0-100>",
    },
];

const options = args(optionDefinitions);

if (options.help) {
    /* tslint:disable:no-console */
    console.log(usage([
        {
            content: "A tool to give a user a power level in a bot user controlled room.",
            header: "Admin Me",
        },
        {
            header: "Options",
            optionList: optionDefinitions,
        },
    ]));
    process.exit(0);
}

if (!options.roomid) {
    console.error("Missing roomid parameter. Check -h");
    process.exit(1);
}

if (!options.userid) {
    console.error("Missing userid parameter. Check -h");
    process.exit(1);
}

const yamlConfig = yaml.safeLoad(fs.readFileSync("discord-registration.yaml", "utf8"));
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
const client = clientFactory.getClientAs();
const intent = new Intent(client, client, {registered: true});
intent.setPowerLevel(options.roomid, options.userid, options.power).then(() => {
    console.log("Power levels set");
    process.exit(0);
}).catch((err) => {
    console.error("Could not apply power levels to room:", err);
    process.exit(1);
});
