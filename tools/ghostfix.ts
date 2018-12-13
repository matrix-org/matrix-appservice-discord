import { AppServiceRegistration, ClientFactory, Bridge } from "matrix-appservice-bridge";
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
import { UserSyncroniser } from "../src/usersyncroniser";
import { Log } from "../src/log";
import { Util } from "../src/util";
import { TextChannel } from "discord.js";

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
        alias: "h",
        description: "Display this usage guide.",
        name: "help",
        type: Boolean,
    },
    {
        alias: "c",
        defaultValue: "config.yaml",
        description: "The AS config file.",
        name: "config",
        type: String,
        typeLabel: "<config.yaml>",
    },
];

const options = args(optionDefinitions);

if (options.help) {
    /* tslint:disable:no-console */
    console.log(usage([
    {
        content: "A tool to fix usernames of ghosts already in " +
        "matrix rooms, to make sure they represent the correct discord usernames.",
        header: "Fix usernames of joined ghosts",
    },
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

const botUserId = `@${registration.sender_localpart}:${config.bridge.domain}`;
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
    domain: config.bridge.domain,
    homeserverUrl: config.bridge.homeserverUrl,
    intentOptions: {
        clients: {
            dontJoin: true, // handled manually
      },
    },
    registration,
    roomStore: config.database.roomStorePath,
    userStore: config.database.userStorePath,
});

provisioner.SetBridge(bridge);
discordbot.setBridge(bridge);

async function run() {
    try {
        await bridge.loadDatabases();
    } catch (e) {
        await discordstore.init();
    }
    const chanSync = new ChannelSyncroniser(bridge, config, discordbot);
    const userSync = new UserSyncroniser(bridge, config, discordbot);
    bridge._clientFactory = clientFactory;
    await discordbot.ClientFactory.init();
    const client = await discordbot.ClientFactory.getClient();

    const promiseList: Promise<void>[] = [];
    let curDelay = config.limits.roomGhostJoinDelay;
    try {
        client.guilds.forEach((guild) => {
            guild.channels.forEach((channel: TextChannel) => {
                if (channel.type !== "text") {
                    return;
                }
                channel.members.forEach((member) => {
                    if (member.id === client.user.id) {
                        return;
                    }
                    promiseList.push((async () => {
                        await Bluebird.delay(curDelay);
                        await Bluebird.each(chanSync.GetRoomIdsFromChannel(channel), async (room) => {
                            let currentSchedule = JOIN_ROOM_SCHEDULE[0];
                            const doJoin = async () => {
                                await Util.DelayedPromise(currentSchedule);
                                await userSync.JoinRoom(member, room);
                            };
                            const errorHandler = async (err) => {
                                log.error(`Error joining room ${room} as ${member.id}`);
                                log.error(err);
                                const idx = JOIN_ROOM_SCHEDULE.indexOf(currentSchedule);
                                if (idx === JOIN_ROOM_SCHEDULE.length - 1) {
                                    log.warn(`Cannot join ${room} as ${member.id}`);
                                    throw new Error(err);
                                } else {
                                    currentSchedule = JOIN_ROOM_SCHEDULE[idx + 1];
                                    try {
                                        await doJoin();
                                    } catch (e) {
                                        await errorHandler(e);
                                    }
                                }
                            };
                            try {
                                await doJoin();
                            } catch (e) {
                                await errorHandler(e);
                            }
                        }).catch((err) => {
                            log.warn(`No associated matrix rooms for discord room ${channel.id}`);
                        });
                    })());
                    curDelay += config.limits.roomGhostJoinDelay;
                });
            });
        });

        await Promise.all(promiseList);
    } catch (err) {
        log.error(err);
    }
    process.exit(0);
}

run(); // tslint:disable-line no-floating-promises
