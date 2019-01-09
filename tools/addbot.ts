/*
Copyright 2017, 2018 matrix-appservice-discord

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
