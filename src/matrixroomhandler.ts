/*
Copyright 2018 matrix-appservice-discord

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
import { Provisioner } from "./provisioner";
import { Log } from "./log";
const log = new Log("MatrixRoomHandler");
import { IMatrixEvent } from "./matrixtypes";
import { DbRoomStore, MatrixStoreRoom, RemoteStoreRoom } from "./db/roomstore";

const ICON_URL = "https://matrix.org/_matrix/media/r0/download/matrix.org/mlxoESwIsTbJrfXyAAogrNxA";
/* tslint:disable:no-magic-numbers */
const HTTP_UNSUPPORTED = 501;
const ROOM_NAME_PARTS = 2;
const AGE_LIMIT = 900000; // 15 * 60 * 1000
const PROVISIONING_DEFAULT_POWER_LEVEL = 50;
const PROVISIONING_DEFAULT_USER_POWER_LEVEL = 0;
const USERSYNC_STATE_DELAY_MS = 5000;
const ROOM_CACHE_MAXAGE_MS = 15 * 60 * 1000;

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
    private botUserId: string;
    private botJoinedRooms: Set<string>; // roomids
    private botJoinedRoomsCacheUpdatedAt = 0;
    constructor(
        private discord: DiscordBot,
        private config: DiscordBridgeConfig,
        private provisioner: Provisioner,
        private bridge: Bridge,
        private roomStore: DbRoomStore) {
        this.botUserId = this.discord.BotUserId;
        this.botJoinedRooms = new Set();
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

    public async OnAliasQueried(alias: string, roomId: string) {
        log.verbose(`Got OnAliasQueried for ${alias} ${roomId}`);
        let channel: Discord.GuildChannel;
        try {
            // We previously stored the room as an alias.
            const entry = (await this.roomStore.getEntriesByMatrixId(alias))[0];
            if (!entry) {
                throw new Error("Entry was not found");
            }
            // Remove the old entry
            await this.roomStore.removeEntriesByMatrixRoomId(
                entry.matrix!.roomId,
            );
            await this.roomStore.linkRooms(
                new MatrixStoreRoom(roomId),
                entry.remote!,
            );
            channel = await this.discord.GetChannelFromRoomId(roomId) as Discord.GuildChannel;
        } catch (err) {
            log.error(`Cannot find discord channel for ${alias} ${roomId}`, err);
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
                log.info(`UserSyncing ${member.id}`);
                try {
                    // Ensure the profile is up to date.
                    await this.discord.UserSyncroniser.OnUpdateUser(member.user);
                } catch (err) {
                    log.warn(`Failed to update profile of user ${member.id}`, err);
                }
                log.info(`Joining ${member.id} to ${roomId}`);

                await this.joinRoom(this.discord.GetIntentFromDiscordMember(member), roomId, member);
            })());
            delay += this.config.limits.roomGhostJoinDelay;
        }
        await Promise.all(promiseList);
    }

    public async OnEvent(request, context: BridgeContext): Promise<void> {
        const event = request.getData() as IMatrixEvent;
        if (event.unsigned.age > AGE_LIMIT) {
            log.warn(`Skipping event due to age ${event.unsigned.age} > ${AGE_LIMIT}`);
            return;
        }
        if (event.type === "m.room.member" && event.content!.membership === "invite") {
            await this.HandleInvite(event);
            return;
        } else if (event.type === "m.room.member" && this.bridge.getBot().isRemoteUser(event.state_key)) {
            if (["leave", "ban"].includes(event.content!.membership!) && event.sender !== event.state_key) {
                // Kick/Ban handling
                let prevMembership = "";
                if (event.content!.membership === "leave") {
                    const intent = this.bridge.getIntent();
                    prevMembership = (await intent.getEvent(event.room_id, event.replaces_state)).content.membership;
                }
                await this.discord.HandleMatrixKickBan(
                    event.room_id,
                    event.state_key,
                    event.sender,
                    event.content!.membership as "leave"|"ban",
                    prevMembership,
                    event.content!.reason,
                );
            }
            return;
        } else if (["m.room.member", "m.room.name", "m.room.topic"].includes(event.type)) {
            await this.discord.ProcessMatrixStateEvent(event);
            return;
        } else if (event.type === "m.room.redaction" && context.rooms.remote) {
            await this.discord.ProcessMatrixRedact(event);
            return;
        } else if (event.type === "m.room.message" || event.type === "m.sticker") {
            log.verbose(`Got ${event.type} event`);
            const isBotCommand = event.type === "m.room.message" &&
                event.content!.body &&
                event.content!.body!.startsWith("!discord");
            if (isBotCommand) {
                await this.ProcessCommand(event, context);
                return;
            } else if (context.rooms.remote) {
                const srvChanPair = context.rooms.remote.roomId.substr("_discord".length).split("_", ROOM_NAME_PARTS);
                try {
                    await this.discord.ProcessMatrixMsgEvent(event, srvChanPair[0], srvChanPair[1]);
                    return;
                } catch (err) {
                    log.warn("There was an error sending a matrix event", err);
                    return;
                }
            }
        } else if (event.type === "m.room.encryption" && context.rooms.remote) {
            try {
                await this.HandleEncryptionWarning(event.room_id);
                return;
            } catch (err) {
                throw new Error(`Failed to handle encrypted room, ${err}`);
            }
        } else {
            log.verbose("Got non m.room.message event");
        }
        log.verbose("Event not processed by bridge");
    }

    public async HandleEncryptionWarning(roomId: string): Promise<void> {
        const intent = this.bridge.getIntent();
        log.info(`User has turned on encryption in ${roomId}, so leaving.`);
        /* N.B 'status' is not specced but https://github.com/matrix-org/matrix-doc/pull/828
         has been open for over a year with no resolution. */
        const sendPromise = intent.sendMessage(roomId, {
            body: "You have turned on encryption in this room, so the service will not bridge any new messages.",
            msgtype: "m.notice",
            status: "critical",
        });
        const channel = await this.discord.GetChannelFromRoomId(roomId);
        await (channel as Discord.TextChannel).send(
          "Someone on Matrix has turned on encryption in this room, so the service will not bridge any new messages",
        );
        await sendPromise;
        await intent.leave(roomId);
        await this.roomStore.removeEntriesByMatrixRoomId(roomId);
    }

    public async HandleInvite(event: IMatrixEvent) {
        log.info(`Received invite for ${event.state_key} in room ${event.room_id}`);
        if (event.state_key === this.botUserId) {
            log.info("Accepting invite for bridge bot");
            await this.joinRoom(this.bridge.getIntent(), event.room_id);
            this.botJoinedRooms.add(event.room_id);
        } else {
            await this.discord.ProcessMatrixStateEvent(event);
        }
    }

    public async ProcessCommand(event: IMatrixEvent, context: BridgeContext) {
        const intent = this.bridge.getIntent();
        if (!(await this.isBotInRoom(event.room_id))) {
            log.warn(`Bot is not in ${event.room_id}. Ignoring command`);
            return;
        }

        if (!this.config.bridge.enableSelfServiceBridging) {
            // We can do this here because the only commands we support are self-service bridging
            return this.bridge.getIntent().sendMessage(event.room_id, {
                body: "The owner of this bridge does not permit self-service bridging.",
                msgtype: "m.notice",
            });
        }

        // Check to make sure the user has permission to do anything in the room. We can do this here
        // because the only commands we support are self-service commands (which therefore require some
        // level of permissions)
        const plEvent = await this.bridge.getIntent().getClient()
            .getStateEvent(event.room_id, "m.room.power_levels", "");
        let userLevel = PROVISIONING_DEFAULT_USER_POWER_LEVEL;
        let requiredLevel = PROVISIONING_DEFAULT_POWER_LEVEL;
        if (plEvent && plEvent.state_default) {
            requiredLevel = plEvent.state_default;
        }
        if (plEvent && plEvent.users_default) {
            userLevel = plEvent.users_default;
        }
        if (plEvent && plEvent.users && plEvent.users[event.sender]) {
            userLevel = plEvent.users[event.sender];
        }

        if (userLevel < requiredLevel) {
            return this.bridge.getIntent().sendMessage(event.room_id, {
                body: "You do not have the required power level in this room to create a bridge to a Discord channel.",
                msgtype: "m.notice",
            });
        }

        const {command, args} = Util.MsgToArgs(event.content!.body as string, "!discord");

        if (command === "help" && args[0] === "bridge") {
            const link = Util.GetBotLink(this.config);
            // tslint:disable prefer-template
            return this.bridge.getIntent().sendMessage(event.room_id, {
                body: "How to bridge a Discord guild:\n" +
                "1. Invite the bot to your Discord guild using this link: " + link + "\n" +
                "2. Invite me to the matrix room you'd like to bridge\n" +
                "3. Open the Discord channel you'd like to bridge in a web browser\n" +
                "4. In the matrix room, send the message `!discord bridge <guild id> <channel id>` " +
                "(without the backticks)\n" +
                "   Note: The Guild ID and Channel ID can be retrieved from the URL in your web browser.\n" +
                "   The URL is formatted as https://discordapp.com/channels/GUILD_ID/CHANNEL_ID\n" +
                "5. Enjoy your new bridge!",
                msgtype: "m.notice",
            });
            // tslint:enable prefer-template
        } else if (command === "bridge") {
            if (context.rooms.remote) {
                return this.bridge.getIntent().sendMessage(event.room_id, {
                    body: "This room is already bridged to a Discord guild.",
                    msgtype: "m.notice",
                });
            }

            const MAXARGS = 2;
            if (args.length > MAXARGS || args.length < 1) {
                return this.bridge.getIntent().sendMessage(event.room_id, {
                    body: "Invalid syntax. For more information try !discord help bridge",
                    msgtype: "m.notice",
                });
            }

            let guildId: string;
            let channelId: string;

            const AMOUNT_OF_IDS_DISCORD_IDENTIFIES_ROOMS_BY = 2;

            if (args.length === AMOUNT_OF_IDS_DISCORD_IDENTIFIES_ROOMS_BY) { // "x y" syntax
                guildId = args[0];
                channelId = args[1];
            } else if (args.length === 1 && args[0].includes("/")) { // "x/y" syntax
                const split = args[0].split("/");
                guildId = split[0];
                channelId = split[1];
            } else {
                return this.bridge.getIntent().sendMessage(event.room_id, {
                    body: "Invalid syntax: See `!discord help`",
                    formatted_body: "Invalid syntax: See <code>!discord help</code>",
                    msgtype: "m.notice",
                });
            }

            try {
                const discordResult = await this.discord.LookupRoom(guildId, channelId);
                const channel = discordResult.channel as Discord.TextChannel;

                log.info(`Bridging matrix room ${event.room_id} to ${guildId}/${channelId}`);
                this.bridge.getIntent().sendMessage(event.room_id, {
                    body: "I'm asking permission from the guild administrators to make this bridge.",
                    msgtype: "m.notice",
                });

                await this.provisioner.AskBridgePermission(channel, event.sender);
                await this.provisioner.BridgeMatrixRoom(channel, event.room_id);
                return this.bridge.getIntent().sendMessage(event.room_id, {
                    body: "I have bridged this room to your channel",
                    msgtype: "m.notice",
                });
            } catch (err) {
                if (err.message === "Timed out waiting for a response from the Discord owners"
                    || err.message === "The bridge has been declined by the Discord guild") {
                    return this.bridge.getIntent().sendMessage(event.room_id, {
                        body: err.message,
                        msgtype: "m.notice",
                    });
                }

                log.error(`Error bridging ${event.room_id} to ${guildId}/${channelId}`);
                log.error(err);
                return this.bridge.getIntent().sendMessage(event.room_id, {
                    body: "There was a problem bridging that channel - has the guild owner approved the bridge?",
                    msgtype: "m.notice",
                });
            }
        } else if (command === "unbridge") {
            const remoteRoom = context.rooms.remote;

            if (!remoteRoom) {
                return this.bridge.getIntent().sendMessage(event.room_id, {
                    body: "This room is not bridged.",
                    msgtype: "m.notice",
                });
            }

            if (!remoteRoom.data.plumbed) {
                return this.bridge.getIntent().sendMessage(event.room_id, {
                    body: "This room cannot be unbridged.",
                    msgtype: "m.notice",
                });
            }

            try {
                await this.provisioner.UnbridgeRoom(remoteRoom);
                return this.bridge.getIntent().sendMessage(event.room_id, {
                    body: "This room has been unbridged",
                    msgtype: "m.notice",
                });
            } catch (err) {
                log.error("Error while unbridging room " + event.room_id);
                log.error(err);
                return this.bridge.getIntent().sendMessage(event.room_id, {
                    body: "There was an error unbridging this room. " +
                      "Please try again later or contact the bridge operator.",
                    msgtype: "m.notice",
                });
            }
        } else if (command === "help") {
            // Unknown command or no command given to get help on, so we'll just give them the help
            // tslint:disable prefer-template
            return this.bridge.getIntent().sendMessage(event.room_id, {
                body: "Available commands:\n" +
                "!discord bridge <guild id> <channel id>   - Bridges this room to a Discord channel\n" +
                "!discord unbridge                         - Unbridges a Discord channel from this room\n" +
                "!discord help <command>                   - Help menu for another command. Eg: !discord help bridge\n",
                msgtype: "m.notice",
            });
            // tslint:enable prefer-template
        }
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
            return this.createMatrixRoom(result.channel, alias, aliasLocalpart);
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

    private async createMatrixRoom(channel: Discord.TextChannel,
                                   alias: string, aliasLocalpart: string): ProvisionedRoom {
        const remote = new RemoteStoreRoom(`discord_${channel.guild.id}_${channel.id}`, {
            discord_channel: channel.id,
            discord_guild: channel.guild.id,
            discord_type: "text",
            update_icon: 1,
            update_name: 1,
            update_topic: 1,
        });
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
            room_alias_name: aliasLocalpart,
            visibility: this.config.room.defaultVisibility,
        };
        // We need to tempoarily store this until we know the room_id.
        await this.roomStore.linkRooms(
            new MatrixStoreRoom(alias),
            remote,
        );
        return {
            creationOpts,
        } as ProvisionedRoom;
    }

    private async isBotInRoom(roomId: string): Promise<boolean> {
        // Update the room cache, if not done already.
        if (Date.now () - this.botJoinedRoomsCacheUpdatedAt > ROOM_CACHE_MAXAGE_MS) {
            log.verbose("Updating room cache for bot...");
            try {
                log.verbose("Got new room cache for bot");
                this.botJoinedRoomsCacheUpdatedAt = Date.now();
                const rooms = (await this.bridge.getBot().getJoinedRooms()) as string[];
                this.botJoinedRooms = new Set(rooms);
            } catch (e) {
                log.error("Failed to get room cache for bot, ", e);
                return false;
            }
        }
        return this.botJoinedRooms.has(roomId);
    }
}
