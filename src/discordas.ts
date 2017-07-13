import { Cli, Bridge, AppServiceRegistration, ClientFactory } from "matrix-appservice-bridge";
import * as log from "npmlog";
import * as yaml from "js-yaml";
import * as fs from "fs";
import { DiscordBridgeConfig } from "./config";
import { DiscordBot } from "./bot";
import { MatrixRoomHandler } from "./matrixroomhandler";
import { DiscordStore } from "./store";

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
  log.level = config.logging ? (config.logging.level || "warn") : "warn";
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
  const discordstore = new DiscordStore(config.database ? config.database.filename : "discord.db");
  const discordbot = new DiscordBot(config, discordstore);
  const roomhandler = new MatrixRoomHandler(discordbot, config, botUserId);

  const bridge = new Bridge({
    clientFactory,
    controller: {
      // onUserQuery: userQuery,
      onAliasQuery: roomhandler.OnAliasQuery.bind(roomhandler),
      onEvent: roomhandler.OnEvent.bind(roomhandler),
      onAliasQueried: roomhandler.OnAliasQueried.bind(roomhandler),
      thirdPartyLookup: roomhandler.ThirdPartyLookup,
      onLog: (line, isError) => {
        log.verbose("matrix-appservice-bridge", line);
      },
    },
    domain: config.bridge.domain,
    homeserverUrl: config.bridge.homeserverUrl,
    registration,
  });
  roomhandler.setBridge(bridge);
  discordbot.setBridge(bridge);
  log.info("discordas", "Initing bridge.");
  log.info("AppServ", "Started listening on port %s at %s", port, new Date().toUTCString() );
  bridge.run(port, config).then(() => {
    log.info("discordas", "Initing store.");
    return discordstore.init();
  }).then(() => {
    log.info("discordas", "Initing bot.");
    return discordbot.run().then(() => {
      log.info("discordas", "Discordbot started successfully.");
    });
  }).catch((err) => {
    log.error("discordas", err);
    log.error("discordas", "Failure during startup. Exiting.");
    process.exit(1);
  });
}
