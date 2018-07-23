import { AppServiceRegistration, ClientFactory, Bridge } from "matrix-appservice-bridge";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as args from "command-line-args";
import * as usage from "command-line-usage";
import * as log from "npmlog";
import * as Bluebird from "bluebird";
import { DiscordBridgeConfig } from "../src/config";
import { DiscordBot } from "../src/bot";
import { DiscordStore } from "../src/store";
import { Provisioner } from "../src/provisioner";
import { UserSyncroniser } from "../src/usersyncroniser";

const optionDefinitions = [
    {
        name: "help",
        alias: "h",
        type: Boolean,
        description: "Display this usage guide.",
    },
    {
      name: "config",
      alias: "c",
      type: String,
      defaultValue: "config.yaml",
      description: "The AS config file.",
      typeLabel: "<config.yaml>",
    },
];

const options = args(optionDefinitions);

if (options.help) {
    /* tslint:disable:no-console */
    console.log(usage([
    {
        header: "Fix usernames of joined ghosts",
        content: "A tool to fix usernames of ghosts already in " +
            "matrix rooms, to make sure they represent the correct discord usernames."},
    {
        header: "Options",
        optionList: optionDefinitions,
    },
    ]));
    process.exit(0);
}

const yamlConfig = yaml.safeLoad(fs.readFileSync("./discord-registration.yaml", "utf8"));
const registration = AppServiceRegistration.fromObject(yamlConfig);
const config: DiscordBridgeConfig = yaml.safeLoad(fs.readFileSync(options.config, "utf8")) as DiscordBridgeConfig;

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
const discordstore = new DiscordStore(config.database ? config.database.filename : "discord.db");
const discordbot = new DiscordBot(config, discordstore, provisioner);

const bridge = new Bridge({
    clientFactory,
    controller: {
        onEvent: () => { },
    },
    intentOptions: {
        clients: {
            dontJoin: true, // handled manually
      },
    },
    domain: config.bridge.domain,
    homeserverUrl: config.bridge.homeserverUrl,
    registration,
    userStore: config.database.userStorePath,
    roomStore: config.database.roomStorePath,
});

provisioner.SetBridge(bridge);
discordbot.setBridge(bridge);
let userSync;

let client;
bridge.loadDatabases().catch((e) => {
    return discordstore.init();
}).then(() => {
    userSync = new UserSyncroniser(bridge, config, discordbot);
    bridge._clientFactory = clientFactory;
    return discordbot.ClientFactory.init().then(() => {
        return discordbot.ClientFactory.getClient();
    });
}).then((clientTmp: any) => {
    client = clientTmp;
    const promiseList = [];
    client.guilds.forEach((guild) => {
        guild.members.forEach((member) => {
            if (member.id === client.user.id) {
                return;
            }
            promiseList.push(Bluebird.each(discordbot.GetRoomIdsFromGuild(guild.id), (room) => {
                return userSync.EnsureJoin(member, room);
            }));
        });
    });
    return Bluebird.all(promiseList);
}).then(() => {
    process.exit(0);
});
