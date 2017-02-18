const yaml = require("js-yaml");
const fs = require("fs");
const flags = require("../node_modules/discord.js/src/util/Constants.js").PermissionFlags;
const yamlConfig = yaml.safeLoad(fs.readFileSync("config.yaml", "utf8"));
if (yamlConfig === null) {
  console.error("You have an error in your discord config.");
}
const client_id = yamlConfig.auth.clientID;
const perms = flags.READ_MESSAGES |
  flags.SEND_MESSAGES |
  flags.CHANGE_NICKNAME |
  flags.CONNECT |
  flags.SPEAK |
  flags.EMBED_LINKS |
  flags.ATTACH_FILES |
  flags.READ_MESSAGE_HISTORY;

console.log(`Go to https://discordapp.com/api/oauth2/authorize?client_id=${client_id}&scope=bot&permissions=${perms} to invite the bot into a guild.`);
