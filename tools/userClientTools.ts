import * as log from "npmlog";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as args from "command-line-args";
import * as usage from "command-line-usage";
import * as readline from "readline";
import * as Bluebird from "bluebird";
import {DiscordClientFactory} from "../src/clientfactory";

import { DiscordBridgeConfig } from "../src/config";
import { DiscordStore } from "../src/store";

const PUPPETING_DOC_URL = "https://github.com/Half-Shot/matrix-appservice-discord/blob/develop/docs/puppeting.md";

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
    name: "add",
    type: Boolean,
    description: "Add the user to the database."},
  {
    name: "remove",
    type: Boolean,
    description: "Remove the user from the database."},
];

const options = args(optionDefinitions);
if (options.help || (options.add && options.remove) || !(options.add || options.remove)) {
  /* tslint:disable:no-console */
  console.log(usage([
    {
      header: "User Client Tools",
      content: "A tool to give a user a power level in a bot user controlled room."},
    {
      header: "Options",
      optionList: optionDefinitions,
    },
  ]));
  process.exit(0);
}

const config: DiscordBridgeConfig = yaml.safeLoad(fs.readFileSync(options.config, "utf8"));
const discordstore = new DiscordStore(config.database ? config.database.filename : "discord.db");
discordstore.init().then(() => {
  log.info("tool", "Loaded database.");
  handleUI();
}).catch((err) => {
  log.info("tool", "Couldn't load database. Cannot continue.");
  log.info("tool", "Ensure the bridge is not running while using this command.");
  process.exit(1);
});

function handleUI() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let userid = null;
  let token = null;

  rl.question("Please enter your UserID ( ex @Half-Shot:half-shot.uk, @username:matrix.org)", (answeru) => {
    userid = answeru;
    if (options.add) {
      rl.question(`
Please enter your Discord Token
(Instructions for this are on ${PUPPETING_DOC_URL})`, (answert) => {
        token = answert;
        rl.close();
        addUserToken(userid, token).then(() => {
          log.info("tool", "Completed successfully");
        }).catch((err) => {
          log.info("tool", "Failed to add, $s", err);
        });
      });
    } else if (options.remove) {
      rl.close();
      discordstore.delete_user_token(userid).then(() => {
        log.info("tool", "Completed successfully");
      }).catch((err) => {
        log.info("tool", "Failed to delete, $s", err);
      });
    }
  });
}

function addUserToken (userid: string, token: string): Bluebird<null> {
  const clientFactory = new DiscordClientFactory(discordstore);
  return clientFactory.getDiscordId(token).then((discordid: string) => {
    return discordstore.add_user_token(userid, discordid, token);
  });
}
