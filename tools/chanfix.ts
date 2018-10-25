import { AppServiceRegistration, ClientFactory, Bridge, Intent } from "matrix-appservice-bridge";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as args from "command-line-args";
import * as usage from "command-line-usage";
import * as Bluebird from "bluebird";
import { ChannelSyncroniser } from "../src/channelsyncroniser";
import { DiscordBridgeConfig } from "../src/config";
import { DiscordBot } from "../src/bot";
import { DiscordStore } from "../src/store";
import { Provisioner } from "../src/provisioner";
import { Log } from "../src/log";
import { Util } from "../src/util";

const log = new Log("ChanFix");

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
        header: "Fix bridged channels",
        content: "A tool to fix channels of rooms already bridged " +
            "to matrix, to make sure their names, icons etc. are correctly."},
    {
        header: "Options",
        optionList: optionDefinitions,
    },
    ]));
    process.exit(0);
}

const yamlConfig = yaml.safeLoad(fs.readFileSync("./discord-registration.yaml", "utf8"));
const registration = AppServiceRegistration.fromObject(yamlConfig);
const config = new DiscordBridgeConfig();
config.ApplyConfig(yaml.safeLoad(fs.readFileSync(options.config, "utf8")) as DiscordBridgeConfig);

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
let chanSync;

let client;
bridge.loadDatabases().catch((e) => {
    return discordstore.init();
}).then(() => {
    chanSync = new ChannelSyncroniser(bridge, config, discordbot);
    bridge._clientFactory = clientFactory;
    bridge._botClient = bridge._clientFactory.getClientAs();
    bridge._botIntent = new Intent(bridge._botClient, bridge._botClient, { registered: true });
    return discordbot.ClientFactory.init().then(() => {
        return discordbot.ClientFactory.getClient();
    });
}).then((clientTmp: any) => {
    client = clientTmp;
    
    // first set update_icon to true if needed
    return bridge.getRoomStore().getEntriesByRemoteRoomData({
        update_name: true,
        update_topic: true,
    });
}).then((mxRoomEntries) => {
    const promiseList = [];
    
    mxRoomEntries.forEach((entry) => {
        if (entry.remote.get("plumbed")) {
            return; // skipping plumbed rooms
        }
        const updateIcon = entry.remote.get("update_icon");
        if (updateIcon !== undefined && updateIcon !== null) {
            return; // skipping because something was set manually
        }
        entry.remote.set("update_icon", true);
        promiseList.push(bridge.getRoomStore().upsertEntry(entry));
    });
    return Promise.all(promiseList);
}).then(() => {
    // now it is time to actually run the updates
    let promiseChain: Bluebird<any> = Bluebird.resolve();
    
    let delay = config.limits.roomGhostJoinDelay; // we'll just re-use this
    client.guilds.forEach((guild) => {
        promiseChain = promiseChain.return(Bluebird.delay(delay).then(() => {
            return chanSync.OnGuildUpdate(guild, true).catch((err) => {
                log.warn(`Couldn't update rooms of guild ${guild.id}`, err);
            });
        }));
        delay += config.limits.roomGhostJoinDelay;
    });
    return promiseChain;
}).catch((err) => {
    log.error(err);
}).then(() => {
    process.exit(0);
});
