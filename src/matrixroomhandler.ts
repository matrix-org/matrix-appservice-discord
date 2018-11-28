import { DiscordBot } from "./bot";
import {
    Bridge,
    RemoteRoom,
    thirdPartyLookup,
    thirdPartyProtocolResult,
    thirdPartyUserResult,
    thirdPartyLocationResult,
    BridgeContext,
    ProvisionedRoom,
    Intent,
} from "matrix-appservice-bridge";
import { DiscordBridgeConfig } from "./config";

import * as Discord from "discord.js";
import * as Bluebird from "bluebird";
import { Util, ICommandActions, ICommandParameters } from "./util";
import { Log } from "./log";
const log = new Log("MatrixRoomHandler");
import { IMatrixEvent } from "./matrixtypes";

const ICON_URL = "https://matrix.org/_matrix/media/r0/download/matrix.org/mlxoESwIsTbJrfXyAAogrNxA";
/* tslint:disable:no-magic-numbers */
const HTTP_UNSUPPORTED = 501;
const ROOM_NAME_PARTS = 2;

// Note: The schedule must not have duplicate values to avoid problems in positioning.
// Disabled because it complains about the values in the array
const JOIN_ROOM_SCHEDULE = [
    0,              // Right away
    1000,           // 1 second
    30000,          // 30 seconds
    300000,         // 5 minutes
    900000,         // 15 minutes
];
/* tslint:enable:no-magic-numbers */

export class MatrixRoomHandler {

    private config: DiscordBridgeConfig;
    private bridge: Bridge;
    private discord: DiscordBot;
    private botUserId: string;
    constructor(discord: DiscordBot, config: DiscordBridgeConfig, botUserId: string) {
        this.discord = discord;
        this.config = config;
        this.botUserId = botUserId;
    }

    public get ThirdPartyLookup(): thirdPartyLookup {
        return {
            getLocation: this.tpGetLocation.bind(this),
            getProtocol: this.tpGetProtocol.bind(this),
            getUser: this.tpGetUser.bind(this),
            parseLocation: this.tpParseLocation.bind(this),
            parseUser: this.tpParseUser.bind(this),
            protocols: ["discord"],
        };
    }

    public setBridge(bridge: Bridge) {
        this.bridge = bridge;
    }

    public async OnAliasQueried(alias: string, roomId: string) {
        log.verbose("OnAliasQueried", `Got OnAliasQueried for ${alias} ${roomId}`);
        let channel: Discord.GuildChannel;
        try {
            channel = await this.discord.GetChannelFromRoomId(roomId) as Discord.GuildChannel;
        } catch (err) {
            log.error("OnAliasQueried", `Cannot find discord channel for ${alias} ${roomId}`, err);
            throw err;
        }

        // Fire and forget RoomDirectory mapping
        this.bridge.getIntent().getClient().setRoomDirectoryVisibilityAppService(
            channel.guild.id,
            roomId,
            "public",
        );
        await this.discord.ChannelSyncroniser.OnUpdate(channel);
        const promiseList: Promise<void>[] = [];
        // Join a whole bunch of users.
        // We delay the joins to give some implementations a chance to breathe
        let delay = this.config.limits.roomGhostJoinDelay;
        for (const member of (channel as Discord.TextChannel).members.array()) {
            if (member.id === this.discord.GetBotId()) {
              continue;
            }
            promiseList.push((async () => {
                await Bluebird.delay(delay);
                log.info("OnAliasQueried", `UserSyncing ${member.id}`);
                try {
                    // Ensure the profile is up to date.
                    await this.discord.UserSyncroniser.OnUpdateUser(member.user);
                } catch (err) {
                    log.warn("OnAliasQueried", `Failed to update profile of user ${member.id}`, err);
                }
                log.info("OnAliasQueried", `Joining ${member.id} to ${roomId}`);

                await this.joinRoom(this.discord.GetIntentFromDiscordMember(member), roomId, member);
            })());
            delay += this.config.limits.roomGhostJoinDelay;
        }
        await Promise.all(promiseList);
    }

    public async OnAliasQuery(alias: string, aliasLocalpart: string): Promise<ProvisionedRoom> {
        log.info("Got request for #", aliasLocalpart);
        const srvChanPair = aliasLocalpart.substr("_discord_".length).split("_", ROOM_NAME_PARTS);
        if (srvChanPair.length < ROOM_NAME_PARTS || srvChanPair[0] === "" || srvChanPair[1] === "") {
            log.warn(`Alias '${aliasLocalpart}' was missing a server and/or a channel`);
            return;
        }
        try {
            const result = await this.discord.LookupRoom(srvChanPair[0], srvChanPair[1]);
            log.info("Creating #", aliasLocalpart);
            return this.createMatrixRoom(result.channel, aliasLocalpart);
        } catch (err) {
            log.error(`Couldn't find discord room '${aliasLocalpart}'.`, err);
        }

    }

    public async tpGetProtocol(protocol: string): Promise<thirdPartyProtocolResult> {
        return {
            field_types: {
                // guild_name: {
                //   regexp: "\S.{0,98}\S",
                //   placeholder: "Guild",
                // },
                channel_id: {
                    placeholder: "",
                    regexp: "[0-9]*",
                },
                channel_name: {
                    placeholder: "#Channel",
                    regexp: "[A-Za-z0-9_\-]{2,100}",
                },
                discriminator: {
                    placeholder: "1234",
                    regexp: "[0-9]{4}",
                },
                guild_id: {
                    placeholder: "",
                    regexp: "[0-9]*",
                },
                username: {
                    placeholder: "Username",
                    regexp: "[A-Za-z0-9_\-]{2,100}",
                },
            },
            instances: this.discord.GetGuilds().map((guild) => {
                return {
                    bot_user_id: this.botUserId,
                    desc: guild.name,
                    fields: {
                        guild_id: guild.id,
                    },
                    icon: guild.iconURL || ICON_URL, // TODO: Use icons from our content repo. Potential security risk.
                    network_id: guild.id,
                };
            }),
            location_fields: ["guild_id", "channel_name"],
            user_fields: ["username", "discriminator"],
        };
    }

    // tslint:disable-next-line no-any
    public async tpGetLocation(protocol: string, fields: any): Promise<thirdPartyLocationResult[]> {
        log.info("Got location request ", protocol, fields);
        const chans = this.discord.ThirdpartySearchForChannels(fields.guild_id, fields.channel_name);
        return chans;
    }

    public async tpParseLocation(alias: string): Promise<thirdPartyLocationResult[]>  {
        throw {err: "Unsupported", code: HTTP_UNSUPPORTED};
    }

    // tslint:disable-next-line no-any
    public async tpGetUser(protocol: string, fields: any): Promise<thirdPartyUserResult[]> {
        log.info("Got user request ", protocol, fields);
        throw {err: "Unsupported", code: HTTP_UNSUPPORTED};
    }

    public async tpParseUser(userid: string): Promise<thirdPartyUserResult[]> {
        throw {err: "Unsupported", code: HTTP_UNSUPPORTED};
    }

    public async HandleDiscordCommand(msg: Discord.Message) {
        if (!(msg.channel as Discord.TextChannel).guild) {
            await msg.channel.send("**ERROR:** only available for guild channels");
        }

        const {command, args} = Util.MsgToArgs(msg.content, "!matrix");

        const intent = this.bridge.getIntent();

        const actions: ICommandActions = {
            ban: {
                description: "Bans a user on the matrix side",
                params: ["name"],
                permission: "BAN_MEMBERS",
                run: this.DiscordModerationActionGenerator(msg.channel as Discord.TextChannel, "ban", "Banned"),
            },
            kick: {
                description: "Kicks a user on the matrix side",
                params: ["name"],
                permission: "KICK_MEMBERS",
                run: this.DiscordModerationActionGenerator(msg.channel as Discord.TextChannel, "kick", "Kicked"),
            },
            unban: {
                description: "Unbans a user on the matrix side",
                params: ["name"],
                permission: "BAN_MEMBERS",
                run: this.DiscordModerationActionGenerator(msg.channel as Discord.TextChannel, "unban", "Unbanned"),
            },
        };

        const parameters: ICommandParameters = {
            name: {
                description: "The display name or mxid of a matrix user",
                get: async (name) => {
                    const channelMxids = await this.discord.ChannelSyncroniser.GetRoomIdsFromChannel(msg.channel);
                    const mxUserId = await Util.GetMxidFromName(intent, name, channelMxids);
                    return mxUserId;
                },
            },
        };

        if (command === "help") {
            let replyHelpMessage = "Available Commands:\n";
            for (const actionKey of Object.keys(actions)) {
                const action = actions[actionKey];
                if (!msg.member.hasPermission(action.permission as Discord.PermissionResolvable)) {
                    continue;
                }
                replyHelpMessage += " - `!matrix " + actionKey;
                for (const param of action.params) {
                    replyHelpMessage += ` <${param}>`;
                }
                replyHelpMessage += `\`: ${action.description}\n`;
            }
            replyHelpMessage += "\nParameters:\n";
            for (const parameterKey of Object.keys(parameters)) {
                const parameter = parameters[parameterKey];
                replyHelpMessage += ` - \`<${parameterKey}>\`: ${parameter.description}\n`;
            }
            await msg.channel.send(replyHelpMessage);
            return;
        }

        if (!actions[command]) {
            await msg.channel.send("**Error:** unknown command. Try `!matrix help` to see all commands");
            return;
        }

        if (!msg.member.hasPermission(actions[command].permission as Discord.PermissionResolvable)) {
            await msg.channel.send("**ERROR:** insufficiant permissions to use this matrix command");
            return;
        }

        let replyMessage = "";
        try {
            replyMessage = await Util.ParseCommand(actions[command], parameters, args);
        } catch (e) {
            replyMessage = "**ERROR:** " + e.message;
        }

        await msg.channel.send(replyMessage);
    }

    private DiscordModerationActionGenerator(discordChannel: Discord.TextChannel, funcKey: string, action: string) {
        return async ({name}) => {
            let allChannelMxids: string[] = [];
            await Promise.all(discordChannel.guild.channels.map(async (chan) => {
                try {
                    const chanMxids = await this.discord.ChannelSyncroniser.GetRoomIdsFromChannel(chan);
                    allChannelMxids = allChannelMxids.concat(chanMxids);
                } catch (e) {
                    // pass, non-text-channel
                }
            }));
            let errorMsg = "";
            await Promise.all(allChannelMxids.map(async (chanMxid) => {
                const intent = this.bridge.getIntent();
                try {
                    await intent[funcKey](chanMxid, name);
                } catch (e) {
                    // maybe we don't have permission to kick/ban/unban...?
                    errorMsg += `\nCouldn't ${funcKey} ${name} from ${chanMxid}`;
                }
            }));
            if (errorMsg) {
                throw Error(errorMsg);
            }
            return `${action} ${name}`;
        };
    }

    private async joinRoom(intent: Intent, roomIdOrAlias: string, member?: Discord.GuildMember): Promise<void> {
        let currentSchedule = JOIN_ROOM_SCHEDULE[0];
        const doJoin = async () => {
            await Util.DelayedPromise(currentSchedule);
            if (member) {
                await this.discord.UserSyncroniser.JoinRoom(member, roomIdOrAlias);
            } else {
                await intent.getClient().joinRoom(roomIdOrAlias);
            }
        };
        const errorHandler = async (err) => {
            log.error(`Error joining room ${roomIdOrAlias} as ${intent.getClient().getUserId()}`);
            log.error(err);
            const idx = JOIN_ROOM_SCHEDULE.indexOf(currentSchedule);
            if (idx === JOIN_ROOM_SCHEDULE.length - 1) {
                log.warn(`Cannot join ${roomIdOrAlias} as ${intent.getClient().getUserId()}`);
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
    }

    private createMatrixRoom(channel: Discord.TextChannel, alias: string): ProvisionedRoom {
        const remote = new RemoteRoom(`discord_${channel.guild.id}_${channel.id}`);
        remote.set("discord_type", "text");
        remote.set("discord_guild", channel.guild.id);
        remote.set("discord_channel", channel.id);
        remote.set("update_name", true);
        remote.set("update_topic", true);
        remote.set("update_icon", true);
        const creationOpts = {
            initial_state: [
                {
                    content: {
                        join_rule: "public",
                    },
                    state_key: "",
                    type: "m.room.join_rules",
                },
            ],
            room_alias_name: alias,
            visibility: this.config.room.defaultVisibility,
        };
        return {
            creationOpts,
            remote,
        } as ProvisionedRoom;
    }
}
