import { Cli, Bridge, AppServiceRegistration, ClientFactory } from "matrix-appservice-bridge";
import * as log from "npmlog";
import * as yaml from "js-yaml";
import * as fs from "fs";
import { DiscordBridgeConfig } from "./config";
import { DiscordBot } from "./discordbot";
import { MatrixRoomHandler } from "./matrixroomhandler";

const cli = new Cli({
  bridgeConfig: {
    affectsRegistration: true,
    schema: "./config/config.schema.yaml",
  },
  registrationPath: "discord-registration.yaml",
  generateRegistration,
  run,
});

try {
  cli.run();
} catch (err) {
  console.error("Init", "Failed to start bridge."); // eslint-disable-line no-console
  console.error("Init", err); // eslint-disable-line no-console
}

function generateRegistration(reg, callback)  {
  reg.setId(AppServiceRegistration.generateToken());
  reg.setHomeserverToken(AppServiceRegistration.generateToken());
  reg.setAppServiceToken(AppServiceRegistration.generateToken());
  reg.setSenderLocalpart("_discord_bot");
  reg.addRegexPattern("users", "@_discord_.*", true);
  reg.addRegexPattern("aliases", "#_discord_.*", true);
  callback(reg);
}

function run (port: number, config: DiscordBridgeConfig) {
  log.info("discordas", "Starting Discord AS");
  const yamlConfig = yaml.safeLoad(fs.readFileSync("discord-registration.yaml", "utf8"));
  const registration = AppServiceRegistration.fromObject(yamlConfig);
  if (registration === null) {
    throw new Error("Failed to parse registration file");
  }
  const botUserId = "@" + registration.sender_localpart + ":" + config.bridge.domain;
  const clientFactory = new ClientFactory({
    appServiceUserId: botUserId,
    token: registration.as_token,
    url: config.bridge.homeserverUrl,
  });
  const discordbot = new DiscordBot(config);
  const roomhandler = new MatrixRoomHandler(discordbot, config, botUserId);

  const bridge = new Bridge({
    clientFactory,
    controller: {
      // onUserQuery: userQuery,
      onAliasQuery: (alias, aliasLocalpart) => {
        return roomhandler.OnAliasQuery(alias, aliasLocalpart);
      },
      onEvent: roomhandler.OnEvent.bind(roomhandler),
      onAliasQueried: roomhandler.OnAliasQueried.bind(roomhandler),
      thirdPartyLookup: roomhandler.ThirdPartyLookup,
      // onLog: function (line, isError) {
      //   if(isError) {
      //     if(line.indexOf("M_USER_IN_USE") === -1) {//QUIET!
      //       log.warn("matrix-appservice-bridge", line);
      //     }
      //   }
      // }
    },
    domain: config.bridge.domain,
    homeserverUrl: config.bridge.homeserverUrl,
    registration,
  });
  roomhandler.setBridge(bridge);
  discordbot.setBridge(bridge);

  log.info("AppServ", "Started listening on port %s at %s", port, new Date().toUTCString() );
  bridge.run(port, config);
  discordbot.run();

}
