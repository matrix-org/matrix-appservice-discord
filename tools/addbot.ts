/* tslint:disable:no-bitwise no-console no-var-requires */
/**
 * Generates a URL you can use to authorize a bot with a guild.
 */
import * as yaml from "js-yaml";
import * as fs from "fs";
import { Permissions } from "discord.js";

const flags = Permissions.FLAGS;
const yamlConfig = yaml.safeLoad(fs.readFileSync("config.yaml", "utf8"));
if (yamlConfig === null) {
  console.error("You have an error in your discord config.");
}
const clientId = yamlConfig.auth.clientID;

const perms = flags.READ_MESSAGES |
  flags.SEND_MESSAGES |
  flags.CHANGE_NICKNAME |
  flags.CONNECT |
  flags.SPEAK |
  flags.EMBED_LINKS |
  flags.ATTACH_FILES |
  flags.READ_MESSAGE_HISTORY |
  flags.MANAGE_WEBHOOKS;

const url = `https://discordapp.com/api/oauth2/authorize?client_id=${clientId}&scope=bot&permissions=${perms}`;
console.log(`Go to ${url} to invite the bot into a guild.`);
