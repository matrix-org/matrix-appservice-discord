/* tslint:disable:no-console */
/**
 * Allows you to become an admin for a room the bot is in control of.
 */

import { AppServiceRegistration, ClientFactory } from "matrix-appservice-bridge";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as args from "command-line-args";
import * as usage from "command-line-usage";
import { DiscordBridgeConfig } from "../src/config";

const optionDefinitions = [
  {
    name: "help",
    alias: "h",
    type: Boolean,
    description: "Display this usage guide."},
  {
    name: "config",
    alias: "c",
    type: String,
    defaultValue: "config.yaml",
    description: "The AS config file.",
    typeLabel: "<config.yaml>" },
  {
    name: "roomid",
    alias: "r",
    type: String,
    description: "The roomid to modify"},
  {
    name: "userid",
    alias: "u",
    type: String,
    description: "The userid to give powers"},
  {
    name: "power",
    alias: "p",
    type: Number,
    defaultValue: 100,
    description: "The power to set",
    typeLabel: "<0-100>" },
];

const options = args(optionDefinitions);

if (options.help) {
  /* tslint:disable:no-console */
  console.log(usage([
    {
      header: "Admin Me",
      content: "A tool to give a user a power level in a bot user controlled room."},
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
client.startClient();
client.on("sync", (state, prevState, data) => {
  switch (state) {
    case "ERROR":
      console.error("Sync failed.", data);
      break;
    case "SYNCING":
      console.log("Syncing.");
      break;
    case "PREPARED":
      const room = client.getRoom(options.roomid);
      if (room === null) {
        console.error("Room not found.");
        process.exit(1);
      }
      const levels = room.getLiveTimeline().getState("f").getStateEvents("m.room.power_levels")[0];
      client.setPowerLevel(options.roomid, options.userid, options.power, levels).then(() => {
        console.log("Power levels set");
        process.exit(0);
      }).catch((err) => {
        console.error("Could not apply power levels: ", err);
        process.exit(1);
      });
      break;
    default:
      break;
  }
});
