import { Cli, Bridge, AppServiceRegistration, ClientFactory } from "matrix-appservice-bridge";
import * as Bluebird from "bluebird";
import * as yaml from "js-yaml";
import * as fs from "fs";
import { DiscordBridgeConfig } from "./config";
import { DiscordBot } from "./bot";
import { MatrixRoomHandler } from "./matrixroomhandler";
import { DiscordStore } from "./store";
import { Provisioner } from "./provisioner";
import { Log } from "./log";

const log = new Log("DiscordAS");

const cli = new Cli({
    bridgeConfig: {
        affectsRegistration: true,
        schema: "./config/config.schema.yaml",
    },
    generateRegistration,
    registrationPath: "discord-registration.yaml",
    run,
});

try {
    cli.run();
} catch (err) {
    log.error("Failed to start bridge.");
    log.error(err);
}

function generateRegistration(reg, callback)  {
    reg.setId(AppServiceRegistration.generateToken());
    reg.setHomeserverToken(AppServiceRegistration.generateToken());
    reg.setAppServiceToken(AppServiceRegistration.generateToken());
    reg.setSenderLocalpart("_discord_bot");
    reg.addRegexPattern("users", "@_discord_.*", true);
    reg.addRegexPattern("aliases", "#_discord_.*", true);
    reg.setRateLimited(false);
    reg.setProtocols(["discord"]);
    callback(reg);
}

function run(port: number, fileConfig: DiscordBridgeConfig) {
    const config = new DiscordBridgeConfig();
    config.ApplyConfig(fileConfig);
    Log.Configure(config.logging);
    log.info("Starting Discord AS");
    const yamlConfig = yaml.safeLoad(fs.readFileSync(cli.opts.registrationPath, "utf8"));
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
    const provisioner = new Provisioner();
    // Warn and deprecate old config options.
    const discordstore = new DiscordStore(config.database);
    const discordbot = new DiscordBot(config, discordstore, provisioner);
    const roomhandler = new MatrixRoomHandler(discordbot, config, botUserId, provisioner);

    const bridge = new Bridge({
        clientFactory,
        controller: {
            // onUserQuery: userQuery,
            onAliasQueried: roomhandler.OnAliasQueried.bind(roomhandler),
            onAliasQuery: roomhandler.OnAliasQuery.bind(roomhandler),
            onEvent: (request, context) =>
                request.outcomeFrom(Bluebird.resolve(roomhandler.OnEvent(request, context))),
            onLog: (line, isError) => {
                log.verbose("matrix-appservice-bridge", line);
            },
            thirdPartyLookup: roomhandler.ThirdPartyLookup,
        },
        domain: config.bridge.domain,
        homeserverUrl: config.bridge.homeserverUrl,
        intentOptions: {
            clients: {
                dontJoin: true, // handled manually
            },
        },
        queue: {
            perRequest: true,
            type: "per_room",
        },
        registration,
        roomStore: config.database.roomStorePath,
        userStore: config.database.userStorePath,
        // To avoid out of order message sending.
    });
    provisioner.SetBridge(bridge);
    roomhandler.setBridge(bridge);
    discordbot.setBridge(bridge);
    discordbot.setRoomHandler(roomhandler);
    log.info("Initing bridge.");
    log.info(`Started listening on port ${port}.`);
    bridge.run(port, config).then(() => {
        log.info("Initing store.");
        return discordstore.init();
    }).then(() => {
        log.info("Initing bot.");
        return discordbot.run().then(() => {
            log.info("Discordbot started successfully.");
        });
    }).catch((err) => {
        log.error(err);
        log.error("Failure during startup. Exiting.");
        process.exit(1);
    });
}
