/* tslint:disable:no-bitwise no-console no-var-requires */
/**
 * Generates a URL you can use to authorize a bot with a guild.
 */
import * as yaml from "js-yaml";
import * as fs from "fs";
import { Util } from "../src/util";

const yamlConfig = yaml.safeLoad(fs.readFileSync("config.yaml", "utf8"));
if (yamlConfig === null) {
  console.error("You have an error in your discord config.");
}

const url = Util.GetBotLink(yamlConfig);
console.log(`Go to ${url} to invite the bot into a guild.`);
