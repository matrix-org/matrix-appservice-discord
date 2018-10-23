import { AppServiceRegistration, ClientFactory, Bridge } from "matrix-appservice-bridge";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as args from "command-line-args";
import * as usage from "command-line-usage";
import * as Bluebird from "bluebird";
import { DiscordBridgeConfig } from "../src/config";
import { DiscordBot } from "../src/bot";
import { DiscordStore } from "../src/store";
import { Provisioner } from "../src/provisioner";
import { UserSyncroniser } from "../src/usersyncroniser";
import { Log } from "../src/log";
import { Util } from "../src/util";

const log = new Log("GhostFix");

// Note: The schedule must not have duplicate values to avoid problems in positioning.
/* tslint:disable:no-magic-numbers */ // Disabled because it complains about the values in the array
const JOIN_ROOM_SCHEDULE = [
    0,              // Right away
    1000,           // 1 second
    30000,          // 30 seconds
    300000,         // 5 minutes
    900000,         // 15 minutes
];
/* tslint:enable:no-magic-numbers */

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
    let promiseChain: Bluebird<any> = Bluebird.resolve();
    
    let delay = config.limits.roomGhostJoinDelay;
    client.guilds.forEach((guild) => {
        guild.channels.forEach((channel) => {
            if (channel.type !== "text") {
                return;
            }
            channel.members.forEach((member) => {
                if (member.id === client.user.id) {
                    return;
                }
                promiseChain = promiseChain.return(Bluebird.delay(delay).then(() => {
                    return Bluebird.each(discordbot.ChannelSyncroniser.GetRoomIdsFromChannel(channel), (room) => {
                        let currentSchedule = JOIN_ROOM_SCHEDULE[0];
                        const doJoin = () => Util.DelayedPromise(currentSchedule).then(() => {
                            userSync.EnsureJoin(member, room);
                        });
                        const errorHandler = (err) => {
                            log.error(`Error joining room ${room} as ${member.id}`);
                            log.error(err);
                            const idx = JOIN_ROOM_SCHEDULE.indexOf(currentSchedule);
                            if (idx === JOIN_ROOM_SCHEDULE.length - 1) {
                                log.warn(`Cannot join ${room} as ${member.id}`);
                                return Promise.reject(err);
                            } else {
                                currentSchedule = JOIN_ROOM_SCHEDULE[idx + 1];
                                return doJoin().catch(errorHandler);
                            }
                        };
                        return doJoin().catch(errorHandler);
                    }).catch((err) => {
                        log.warn(`No associated matrix rooms for discord room ${channel.id}`);
                    });
                }));
                delay += config.limits.roomGhostJoinDelay;
            });
        });
    });
    return promiseChain;
}).catch((err) => {
    log.error(err);
}).then(() => {
    process.exit(0);
});
