/*
Copyright 2017, 2018 matrix-appservice-discord

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

import { DiscordBridgeConfig } from "./config";
import { DiscordClientFactory } from "./clientfactory";
import { DiscordStore } from "./store";
import { DbEmoji } from "./db/dbdataemoji";
import { DbEvent } from "./db/dbdataevent";
import { MatrixUser, RemoteUser, Bridge, Entry, Intent } from "matrix-appservice-bridge";
import { Util } from "./util";
import {
    DiscordMessageProcessor,
    DiscordMessageProcessorOpts,
    DiscordMessageProcessorResult,
} from "./discordmessageprocessor";
import { MatrixEventProcessor, MatrixEventProcessorOpts } from "./matrixeventprocessor";
import { PresenceHandler } from "./presencehandler";
import { Provisioner } from "./provisioner";
import { UserSyncroniser } from "./usersyncroniser";
import { ChannelSyncroniser } from "./channelsyncroniser";
import { MatrixRoomHandler } from "./matrixroomhandler";
import { Log } from "./log";
import * as Discord from "discord.js";
import * as Bluebird from "bluebird";
import * as mime from "mime";
import { IMatrixEvent, IMatrixMediaInfo } from "./matrixtypes";

const log = new Log("DiscordBot");

const MIN_PRESENCE_UPDATE_DELAY = 250;

// TODO: This is bad. We should be serving the icon from the own homeserver.
const MATRIX_ICON_URL = "https://matrix.org/_matrix/media/r0/download/matrix.org/mlxoESwIsTbJrfXyAAogrNxA";
class ChannelLookupResult {
    public channel: Discord.TextChannel;
    public botUser: boolean;
}

interface IThirdPartyLookupField {
    channel_id: string;
    channel_name: string;
    guild_id: string;
}

interface IThirdPartyLookup {
    alias: string;
    fields: IThirdPartyLookupField;
    protocol: string;
}

export class DiscordBot {
    private config: DiscordBridgeConfig;
    private clientFactory: DiscordClientFactory;
    private store: DiscordStore;
    private bot: Discord.Client;
    private bridge: Bridge;
    private presenceInterval: number;
    private sentMessages: string[];
    private lastEventIds: { [channelId: string]: string };
    private discordMsgProcessor: DiscordMessageProcessor;
    private mxEventProcessor: MatrixEventProcessor;
    private presenceHandler: PresenceHandler;
    private userSync: UserSyncroniser;
    private channelSync: ChannelSyncroniser;
    private roomHandler: MatrixRoomHandler;

    /* Handles messages queued up to be sent to discord. */
    private discordMessageQueue: { [channelId: string]: Promise<void> };

    constructor(config: DiscordBridgeConfig, store: DiscordStore, private provisioner: Provisioner) {
        this.config = config;
        this.store = store;
        this.sentMessages = [];
        this.clientFactory = new DiscordClientFactory(store, config.auth);
        this.discordMsgProcessor = new DiscordMessageProcessor(
            new DiscordMessageProcessorOpts(this.config.bridge.domain, this),
        );
        this.presenceHandler = new PresenceHandler(this);
        this.discordMessageQueue = {};
        this.lastEventIds = {};
    }

    public setBridge(bridge: Bridge) {
        this.bridge = bridge;
        this.mxEventProcessor = new MatrixEventProcessor(
            new MatrixEventProcessorOpts(this.config, bridge, this),
        );
        this.channelSync = new ChannelSyncroniser(this.bridge, this.config, this);
    }

    public setRoomHandler(roomHandler: MatrixRoomHandler) {
        this.roomHandler = roomHandler;
    }

    get ClientFactory(): DiscordClientFactory {
        return this.clientFactory;
    }

    get UserSyncroniser(): UserSyncroniser {
        return this.userSync;
    }

    get ChannelSyncroniser(): ChannelSyncroniser {
        return this.channelSync;
    }

    public GetIntentFromDiscordMember(member: Discord.GuildMember | Discord.User, webhookID?: string): Intent {
        if (webhookID) {
            // webhookID and user IDs are the same, they are unique, so no need to prefix _webhook_
            const name = member instanceof Discord.User ? member.username : member.user.username;
            const nameId = new MatrixUser(`@${name}`).localpart;
            return this.bridge.getIntentFromLocalpart(`_discord_${webhookID}_${nameId}`);
        }
        return this.bridge.getIntentFromLocalpart(`_discord_${member.id}`);
    }

    public async run(): Promise<void> {
        await this.clientFactory.init();
        const client = await this.clientFactory.getClient();

        if (!this.config.bridge.disableTypingNotifications) {
            client.on("typingStart", async (c, u) => {
                try {
                    await this.OnTyping(c, u, true);
                } catch (err) { log.warning("Exception thrown while handling \"typingStart\" event", err); }
            });
            client.on("typingStop", async (c, u) => {
                try {
                    await this.OnTyping(c, u, false);
                } catch (err) { log.warning("Exception thrown while handling \"typingStop\" event", err); }
            });
        }
        if (!this.config.bridge.disablePresence) {
            client.on("presenceUpdate", (_, newMember: Discord.GuildMember) => {
                try {
                    this.presenceHandler.EnqueueUser(newMember.user);
                } catch (err) { log.warning("Exception thrown while handling \"presenceUpdate\" event", err); }
            });
        }
        client.on("channelUpdate", async (_, newChannel) => {
            try {
                await this.channelSync.OnUpdate(newChannel);
            } catch (err) { log.error("Exception thrown while handling \"channelUpdate\" event", err); }
        });
        client.on("channelDelete", async (channel) => {
            try {
                await this.channelSync.OnDelete(channel);
            } catch (err) { log.error("Exception thrown while handling \"channelDelete\" event", err); }
        });
        client.on("guildUpdate", async (_, newGuild) => {
            try {
                await this.channelSync.OnGuildUpdate(newGuild);
            } catch (err) { log.error("Exception thrown while handling \"guildUpdate\" event", err); }
        });
        client.on("guildDelete", async (guild) => {
            try {
                await this.channelSync.OnGuildDelete(guild);
            } catch (err) { log.error("Exception thrown while handling \"guildDelete\" event", err); }
        });

        // Due to messages often arriving before we get a response from the send call,
        // messages get delayed from discord. We use Bluebird.delay to handle this.

        client.on("messageDelete", async (msg: Discord.Message) => {
            try {
                await Bluebird.delay(this.config.limits.discordSendDelay);
                this.discordMessageQueue[msg.channel.id] = (async () => {
                    await (this.discordMessageQueue[msg.channel.id] || Promise.resolve());
                    try {
                        await this.DeleteDiscordMessage(msg);
                    } catch (err) {
                        log.error("Caught while handing 'messageDelete'", err);
                    }
                })();
            } catch (err) {
                log.error("Exception thrown while handling \"messageDelete\" event", err);
            }
        });
        client.on("messageUpdate", async (oldMessage: Discord.Message, newMessage: Discord.Message) => {
            try {
                await Bluebird.delay(this.config.limits.discordSendDelay);
                this.discordMessageQueue[newMessage.channel.id] = (async () => {
                    await (this.discordMessageQueue[newMessage.channel.id] || Promise.resolve());
                    try {
                        await this.OnMessageUpdate(oldMessage, newMessage);
                    } catch (err) {
                        log.error("Caught while handing 'messageUpdate'", err);
                    }
                })();
            } catch (err) {
                log.error("Exception thrown while handling \"messageUpdate\" event", err);
            }
        });
        client.on("message", async (msg: Discord.Message) => {
            try {
                await Bluebird.delay(this.config.limits.discordSendDelay);
                this.discordMessageQueue[msg.channel.id] = (async () => {
                    await (this.discordMessageQueue[msg.channel.id] || Promise.resolve());
                    try {
                        await this.OnMessage(msg);
                    } catch (err) {
                        log.error("Caught while handing 'message'", err);
                    }
                })();
            } catch (err) {
                log.error("Exception thrown while handling \"message\" event", err);
            }
        });
        const jsLog = new Log("discord.js");

        this.userSync = new UserSyncroniser(this.bridge, this.config, this);
        client.on("userUpdate", async (_, user) => {
            try {
                await this.userSync.OnUpdateUser(user);
            } catch (err) { log.error("Exception thrown while handling \"userUpdate\" event", err); }
        });
        client.on("guildMemberAdd", async (user) => {
            try {
                await this.userSync.OnAddGuildMember(user);
            } catch (err) { log.error("Exception thrown while handling \"guildMemberAdd\" event", err); }
        });
        client.on("guildMemberRemove", async (user) =>  {
            try {
                await this.userSync.OnRemoveGuildMember(user);
            } catch (err) { log.error("Exception thrown while handling \"guildMemberRemove\" event", err); }
        });
        client.on("guildMemberUpdate", async (_, member) => {
            try {
                await this.userSync.OnUpdateGuildMember(member);
            } catch (err) { log.error("Exception thrown while handling \"guildMemberUpdate\" event", err); }
        });
        client.on("debug", (msg) => { jsLog.verbose(msg); });
        client.on("error", (msg) => { jsLog.error(msg); });
        client.on("warn", (msg) => { jsLog.warn(msg); });
        log.info("Discord bot client logged in.");
        this.bot = client;

        if (!this.config.bridge.disablePresence) {
            if (!this.config.bridge.presenceInterval) {
                this.config.bridge.presenceInterval = MIN_PRESENCE_UPDATE_DELAY;
            }
            this.bot.guilds.forEach((guild) => {
                guild.members.forEach((member) => {
                    if (member.id !== this.GetBotId()) {
                        this.presenceHandler.EnqueueUser(member.user);
                    }
                });
            });
            await this.presenceHandler.Start(
                Math.max(this.config.bridge.presenceInterval, MIN_PRESENCE_UPDATE_DELAY),
            );
        }
    }

    public GetBotId(): string {
        return this.bot.user.id;
    }

    public GetGuilds(): Discord.Guild[] {
        return this.bot.guilds.array();
    }

    public ThirdpartySearchForChannels(guildId: string, channelName: string): IThirdPartyLookup[] {
        if (channelName.startsWith("#")) {
            channelName = channelName.substr(1);
        }
        if (this.bot.guilds.has(guildId) ) {
            const guild = this.bot.guilds.get(guildId);
            return guild!.channels.filter((channel) => {
                return channel.name.toLowerCase() === channelName.toLowerCase(); // Implement searching in the future.
            }).map((channel) => {
                return {
                    alias: `#_discord_${guild!.id}_${channel.id}:${this.config.bridge.domain}`,
                    fields: {
                        channel_id: channel.id,
                        channel_name: channel.name,
                        guild_id: guild!.id,
                    },
                    protocol: "discord",
                } as IThirdPartyLookup;
            });
        } else {
            log.info("Tried to do a third party lookup for a channel, but the guild did not exist");
            return [];
        }
    }

    public async LookupRoom(server: string, room: string, sender?: string): Promise<ChannelLookupResult> {
        const hasSender = sender !== null && sender !== undefined;
        try {
            const client = await this.clientFactory.getClient(sender);
            const guild = client.guilds.get(server);
            if (!guild) {
                throw new Error(`Guild "${server}" not found`);
            }
            const channel = guild.channels.get(room);
            if (channel && channel.type === "text") {
                const lookupResult = new ChannelLookupResult();
                lookupResult.channel = channel as Discord.TextChannel;
                lookupResult.botUser = this.bot.user.id === client.user.id;
                return lookupResult;
            }
            throw new Error(`Channel "${room}" not found`);
        } catch (err) {
            log.verbose("LookupRoom => ", err);
            if (hasSender) {
                log.verbose(`Couldn't find guild/channel under user account. Falling back.`);
                return await this.LookupRoom(server, room);
            }
            throw err;
        }
    }

    public async ProcessMatrixStateEvent(event: IMatrixEvent): Promise<void> {
        log.verbose(`Got state event from ${event.room_id} ${event.type}`);
        const channel = await this.GetChannelFromRoomId(event.room_id) as Discord.TextChannel;
        const msg = this.mxEventProcessor.StateEventToMessage(event, channel);
        if (!msg) {
            return;
        }
        let res = await channel.send(msg);
        if (!Array.isArray(res)) {
            res = [res];
        }
        await Util.AsyncForEach(res, async (m: Discord.Message) => {
            log.verbose("Sent (state msg) ", m.id);
            this.sentMessages.push(m.id);
            this.lastEventIds[event.room_id] = event.event_id;
            const evt = new DbEvent();
            evt.MatrixId = `${event.event_id};${event.room_id}`;
            evt.DiscordId = m.id;
            evt.GuildId = channel.guild.id;
            evt.ChannelId = channel.id;
            await this.store.Insert(evt);
        });
        if (!this.config.bridge.disableReadReceipts) {
            try {
                await this.bridge.getIntent().sendReadReceipt(event.room_id, event.event_id);
            } catch (err) {
                log.error(`Failed to send read receipt for ${event}. `, err);
            }
        }
    }

    public async ProcessMatrixMsgEvent(event: IMatrixEvent, guildId: string, channelId: string): Promise<void> {
        const mxClient = this.bridge.getClientFactory().getClientAs();
        log.verbose(`Looking up ${guildId}_${channelId}`);
        const result = await this.LookupRoom(guildId, channelId, event.sender);
        const chan = result.channel;
        const botUser = result.botUser;

        const embedSet = await this.mxEventProcessor.EventToEmbed(event, chan);
        const embed = embedSet.messageEmbed;
        const opts: Discord.MessageOptions = {};
        const file = await this.mxEventProcessor.HandleAttachment(event, mxClient);
        if (typeof(file) === "string") {
            embed.description += " " + file;
        } else {
            opts.file = file;
        }

        let msg: Discord.Message | null | (Discord.Message | null)[] = null;
        let hook: Discord.Webhook | undefined;
        if (botUser) {
            const webhooks = await chan.fetchWebhooks();
            hook = webhooks.filterArray((h) => h.name === "_matrix").pop();
            // Create a new webhook if none already exists
            try {
                if (!hook) {
                    hook = await chan.createWebhook(
                        "_matrix",
                        MATRIX_ICON_URL,
                        "Matrix Bridge: Allow rich user messages");
                }
            } catch (err) {
                log.error("Unable to create \"_matrix\" webhook. ", err);
            }
        }
        try {
            if (!botUser) {
                opts.embed = embedSet.replyEmbed;
                msg = await chan.send(embed.description, opts);
            } else if (hook) {
                msg = await hook.send(embed.description, {
                    avatarURL: embed!.author!.icon_url,
                    embeds: embedSet.replyEmbed ? [embedSet.replyEmbed] : undefined,
                    files: opts.file ? [opts.file] : undefined,
                    username: embed!.author!.name,
                } as Discord.WebhookMessageOptions);
            } else {
                if (embedSet.replyEmbed) {
                    embed.addField("Replying to", embedSet.replyEmbed!.author!.name);
                    embed.addField("Reply text", embedSet.replyEmbed.description);
                }
                opts.embed = embed;
                msg = await chan.send("", opts);
            }
        } catch (err) {
            log.error("Couldn't send message. ", err);
        }
        if (!Array.isArray(msg)) {
            msg = [msg];
        }
        await Util.AsyncForEach(msg, async (m: Discord.Message) => {
            log.verbose("Sent ", m.id);
            this.sentMessages.push(m.id);
            this.lastEventIds[event.room_id] = event.event_id;
            const evt = new DbEvent();
            evt.MatrixId = `${event.event_id};${event.room_id}`;
            evt.DiscordId = m.id;
            // Webhooks don't send guild info.
            evt.GuildId = guildId;
            evt.ChannelId = channelId;
            await this.store.Insert(evt);
        });
        if (!this.config.bridge.disableReadReceipts) {
            try {
                await this.bridge.getIntent().sendReadReceipt(event.room_id, event.event_id);
            } catch (err) {
                log.error(`Failed to send read receipt for ${event}. `, err);
            }
        }
        return;
    }

    public async ProcessMatrixRedact(event: IMatrixEvent) {
        if (this.config.bridge.disableDeletionForwarding) {
            return;
        }
        log.info(`Got redact request for ${event.redacts}`);
        log.verbose(`Event:`, event);

        const storeEvent = await this.store.Get(DbEvent, {matrix_id: `${event.redacts};${event.room_id}`});

        if (!storeEvent || !storeEvent.Result) {
            log.warn(`Could not redact because the event was not in the store.`);
            return;
        }
        log.info(`Redact event matched ${storeEvent.ResultCount} entries`);
        while (storeEvent.Next()) {
            log.info(`Deleting discord msg ${storeEvent.DiscordId}`);
            const result = await this.LookupRoom(storeEvent.GuildId, storeEvent.ChannelId, event.sender);
            const chan = result.channel;

            const msg = await chan.fetchMessage(storeEvent.DiscordId);
            try {
                await msg.delete();
                log.info(`Deleted message`);
            } catch (ex) {
                log.warn(`Failed to delete message`, ex);
            }
        }
    }

    public OnUserQuery(userId: string): boolean {
        return false;
    }

    public async GetDiscordUserOrMember(
        userId: Discord.Snowflake, guildId?: Discord.Snowflake,
    ): Promise<Discord.User|Discord.GuildMember|undefined> {
        try {
            if (guildId && this.bot.guilds.has(guildId)) {
                return await this.bot.guilds.get(guildId)!.fetchMember(userId);
            }
            return await this.bot.fetchUser(userId);
        } catch (ex) {
            log.warn(`Could not fetch user data for ${userId} (guild: ${guildId})`);
            return undefined;
        }
    }

    public async GetChannelFromRoomId(roomId: string, client?: Discord.Client): Promise<Discord.Channel> {
        const entries = await this.bridge.getRoomStore().getEntriesByMatrixId(
            roomId,
        );

        if (!client) {
            client = this.bot;
        }

        if (entries.length === 0) {
            log.verbose(`Couldn"t find channel for roomId ${roomId}.`);
            throw Error("Room(s) not found.");
        }
        const entry = entries[0];
        const guild = client.guilds.get(entry.remote.get("discord_guild"));
        if (guild) {
            const channel = client.channels.get(entry.remote.get("discord_channel"));
            if (channel) {
                return channel;
            }
            throw Error("Channel given in room entry not found");
        }
        throw Error("Guild given in room entry not found");
    }

    public async GetEmoji(name: string, animated: boolean, id: string): Promise<string> {
        if (!id.match(/^\d+$/)) {
            throw new Error("Non-numerical ID");
        }
        const dbEmoji = await this.store.Get(DbEmoji, {emoji_id: id});
        if (!dbEmoji) {
            throw new Error("Couldn't fetch from store");
        }
        if (!dbEmoji.Result) {
            const url = `https://cdn.discordapp.com/emojis/${id}${animated ? ".gif" : ".png"}`;
            const intent = this.bridge.getIntent();
            const mxcUrl = (await Util.UploadContentFromUrl(url, intent, name)).mxcUrl;
            dbEmoji.EmojiId = id;
            dbEmoji.Name = name;
            dbEmoji.Animated = animated;
            dbEmoji.MxcUrl = mxcUrl;
            await this.store.Insert(dbEmoji);
        }
        return dbEmoji.MxcUrl;
    }

    public async GetRoomIdsFromGuild(guild: Discord.Guild, member?: Discord.GuildMember): Promise<string[]> {
        if (member) {
            let rooms: string[] = [];
            await Util.AsyncForEach(guild.channels.array(), async (channel) => {
                if (channel.type !== "text" || !channel.members.has(member.id)) {
                    return;
                }
                try {
                    rooms = rooms.concat(await this.channelSync.GetRoomIdsFromChannel(channel));
                } catch (e) { } // no bridged rooms for this channel
            });
            if (rooms.length === 0) {
                log.verbose(`No rooms were found for this guild and member (guild:${guild.id} member:${member.id})`);
                throw new Error("Room(s) not found.");
            }
            return rooms;
        } else {
            const rooms = await this.bridge.getRoomStore().getEntriesByRemoteRoomData({
                discord_guild: guild.id,
            });
            if (rooms.length === 0) {
                log.verbose(`Couldn't find room(s) for guild id:${guild.id}.`);
                throw new Error("Room(s) not found.");
            }
            return rooms.map((room) => room.matrix.getId());
        }
    }

    public async HandleMatrixKickBan(
        roomId: string, kickeeUserId: string, kicker: string, kickban: "leave"|"ban",
        previousState: string, reason?: string,
    ) {
        const restore = kickban === "leave" && previousState === "ban";
        const client = await this.clientFactory.getClient(kicker);
        let channel: Discord.Channel;
        try {
            channel = await this.GetChannelFromRoomId(roomId, client);
        } catch (ex) {
            log.error("Failed to get channel for ", roomId, ex);
            return;
        }
        if (channel.type !== "text") {
            log.warn("Channel was not a text channel");
            return;
        }
        const tchan = (channel as Discord.TextChannel);
        const kickeeUser = (await this.GetDiscordUserOrMember(
            new MatrixUser(kickeeUserId.replace("@", "")).localpart.substring("_discord".length),
            tchan.guild.id,
        ));
        if (!kickeeUser) {
            log.error("Could not find discord user for", kickeeUserId);
            return;
        }
        const kickee = kickeeUser as Discord.GuildMember;
        let res: Discord.Message;
        const botChannel = await this.GetChannelFromRoomId(roomId) as Discord.TextChannel;
        if (restore) {
            await tchan.overwritePermissions(kickee,
                {
                  SEND_MESSAGES: null,
                  VIEW_CHANNEL: null,
                  /* tslint:disable-next-line no-any */
              } as any, // XXX: Discord.js typings are wrong.
                `Unbanned.`);
            res = await botChannel.send(
                `${kickee} was unbanned from this channel by ${kicker}.`,
            ) as Discord.Message;
            this.sentMessages.push(res.id);
            return;
        }
        const existingPerms = tchan.memberPermissions(kickee);
        if (existingPerms && existingPerms.has(Discord.Permissions.FLAGS.VIEW_CHANNEL as number) === false ) {
            log.warn("User isn't allowed to read anyway.");
            return;
        }
        const word = `${kickban === "ban" ? "banned" : "kicked"}`;
        res = await botChannel.send(
            `${kickee} was ${word} from this channel by ${kicker}.`
            + (reason ? ` Reason: ${reason}` : ""),
        ) as Discord.Message;
        this.sentMessages.push(res.id);
        log.info(`${word} ${kickee}`);

        await tchan.overwritePermissions(kickee,
            {
              SEND_MESSAGES: false,
              VIEW_CHANNEL: false,
            },
            `Matrix user was ${word} by ${kicker}`);
        if (kickban === "leave") {
            // Kicks will let the user back in after ~30 seconds.
            setTimeout(async () => {
                log.info(`Kick was lifted for ${kickee.displayName}`);
                await tchan.overwritePermissions(kickee,
                    {
                      SEND_MESSAGES: null,
                      VIEW_CHANNEL: null,
                      /* tslint:disable: no-any */
                  } as any, // XXX: Discord.js typings are wrong.
                    `Lifting kick since duration expired.`);
            }, this.config.room.kickFor);
        }
    }

    public async GetEmojiByMxc(mxc: string): Promise<DbEmoji> {
        const dbEmoji = await this.store.Get(DbEmoji, {mxc_url: mxc});
        if (!dbEmoji || !dbEmoji.Result) {
            throw new Error("Couldn't fetch from store");
        }
        return dbEmoji;
    }

    private async SendMatrixMessage(matrixMsg: DiscordMessageProcessorResult, chan: Discord.Channel,
                                    guild: Discord.Guild, author: Discord.User,
                                    msgID: string): Promise<boolean> {
        const rooms = await this.channelSync.GetRoomIdsFromChannel(chan);
        const intent = this.GetIntentFromDiscordMember(author);

        await Util.AsyncForEach(rooms, async (room) => {
            const res = await intent.sendMessage(room, {
                body: matrixMsg.body,
                format: "org.matrix.custom.html",
                formatted_body: matrixMsg.formattedBody,
                msgtype: "m.text",
            });
            this.lastEventIds[room] = res.event_id;
            const evt = new DbEvent();
            evt.MatrixId = `${res.event_id};${room}`;
            evt.DiscordId = msgID;
            evt.ChannelId = chan.id;
            evt.GuildId = guild.id;
            await this.store.Insert(evt);
        });

        // Sending was a success
        return true;
    }

    private async OnTyping(channel: Discord.Channel, user: Discord.User, isTyping: boolean) {
        const rooms = await this.channelSync.GetRoomIdsFromChannel(channel);
        try {
            const intent = this.GetIntentFromDiscordMember(user);
            await Promise.all(rooms.map((room) => {
                return intent.sendTyping(room, isTyping);
            }));
        } catch (err) {
            log.warn("Failed to send typing indicator.", err);
        }
    }

    private async OnMessage(msg: Discord.Message) {
        const indexOfMsg = this.sentMessages.indexOf(msg.id);
        const chan = msg.channel as Discord.TextChannel;
        if (indexOfMsg !== -1) {
            log.verbose("Got repeated message, ignoring.");
            delete this.sentMessages[indexOfMsg];
            return; // Skip *our* messages
        }
        if (msg.author.id === this.bot.user.id) {
            // We don't support double bridging.
            return;
        }
        // Test for webhooks
        if (msg.webhookID) {
            const webhook = (await chan.fetchWebhooks())
                            .filterArray((h) => h.name === "_matrix").pop();
            if (webhook && msg.webhookID === webhook.id) {
              // Filter out our own webhook messages.
                return;
            }
        }

        // Check if there's an ongoing bridge request
        if ((msg.content === "!approve" || msg.content === "!deny") && this.provisioner.HasPendingRequest(chan)) {
            try {
                const isApproved = msg.content === "!approve";
                const successfullyBridged = await this.provisioner.MarkApproved(chan, msg.member, isApproved);
                if (successfullyBridged && isApproved) {
                    await msg.channel.sendMessage("Thanks for your response! The matrix bridge has been approved");
                } else if (successfullyBridged && !isApproved) {
                    await msg.channel.sendMessage("Thanks for your response! The matrix bridge has been declined");
                } else {
                    await msg.channel.sendMessage("Thanks for your response, however" +
                        "the time for responses has expired - sorry!");
                }
            } catch (err) {
                if (err.message === "You do not have permission to manage webhooks in this channel") {
                    await msg.channel.sendMessage(err.message);
                } else {
                    log.error("Error processing room approval");
                    log.error(err);
                }
            }

            return; // stop processing - we're approving/declining the bridge request
        }

        // check if it is a command to process by the bot itself
        if (msg.content.startsWith("!matrix")) {
            await this.roomHandler.HandleDiscordCommand(msg);
            return;
        }

        // Update presence because sometimes discord misses people.
        await this.userSync.OnUpdateUser(msg.author, msg.webhookID);
        let rooms;
        try {
            rooms = await this.channelSync.GetRoomIdsFromChannel(msg.channel);
        } catch (err) {
            log.verbose("No bridged rooms to send message to. Oh well.");
            return null;
        }
        try {
            if (rooms === null) {
              return null;
            }
            const intent = this.GetIntentFromDiscordMember(msg.author, msg.webhookID);
            // Check Attachements
            await Util.AsyncForEach(msg.attachments.array(), async (attachment) => {
                const content = await Util.UploadContentFromUrl(attachment.url, intent, attachment.filename);
                const fileMime = mime.lookup(attachment.filename);
                const type = fileMime.split("/")[0];
                let msgtype = {
                    audio: "m.audio",
                    image: "m.image",
                    video: "m.video",
                }[type];
                if (!msgtype) {
                    msgtype = "m.file";
                }
                const info = {
                    mimetype: fileMime,
                    size: attachment.filesize,
                } as IMatrixMediaInfo;
                if (msgtype === "m.image" || msgtype === "m.video") {
                    info.w = attachment.width;
                    info.h = attachment.height;
                }
                await Util.AsyncForEach(rooms, async (room) => {
                    const res = await intent.sendMessage(room, {
                        body: attachment.filename,
                        external_url: attachment.url,
                        info,
                        msgtype,
                        url: content.mxcUrl,
                    });
                    this.lastEventIds[room] = res.event_id;
                    const evt = new DbEvent();
                    evt.MatrixId = `${res.event_id};${room}`;
                    evt.DiscordId = msg.id;
                    evt.ChannelId = msg.channel.id;
                    evt.GuildId = msg.guild.id;
                    await this.store.Insert(evt);
                });
            });
            if (msg.content === null) {
                return;
            }
            const result = await this.discordMsgProcessor.FormatMessage(msg);
            if (!result.body) {
                return;
            }
            await Util.AsyncForEach(rooms, async (room) => {
                const trySend = async () => intent.sendMessage(room, {
                    body: result.body,
                    format: "org.matrix.custom.html",
                    formatted_body: result.formattedBody,
                    msgtype: result.msgtype,
                });
                const afterSend = async (re) => {
                    this.lastEventIds[room] = re.event_id;
                    const evt = new DbEvent();
                    evt.MatrixId = `${re.event_id};${room}`;
                    evt.DiscordId = msg.id;
                    evt.ChannelId = msg.channel.id;
                    evt.GuildId = msg.guild.id;
                    await this.store.Insert(evt);
                };
                let res;
                try {
                    res = await trySend();
                    await afterSend(res);
                } catch (e) {
                    if (e.errcode !== "M_FORBIDDEN" && e.errcode !==  "M_GUEST_ACCESS_FORBIDDEN") {
                        log.error("DiscordBot", "Failed to send message into room.", e);
                        return;
                    }
                    if (msg.member) {
                        await this.userSync.JoinRoom(msg.member, room);
                    } else {
                        await this.userSync.JoinRoom(msg.author, room, msg.webhookID);
                    }
                    res = await trySend();
                    await afterSend(res);
                }
            });
        } catch (err) {
            log.verbose("Failed to send message into room.", err);
        }
    }

    private async OnMessageUpdate(oldMsg: Discord.Message, newMsg: Discord.Message) {
        // Check if an edit was actually made
        if (oldMsg.content === newMsg.content) {
            return;
        }
        log.info(`Got edit event for ${newMsg.id}`);
        let link = "";
        const storeEvent = await this.store.Get(DbEvent, {discord_id: oldMsg.id});
        if (storeEvent && storeEvent.Result) {
            while (storeEvent.Next()) {
                const matrixIds = storeEvent.MatrixId.split(";");
                if (matrixIds[0] === this.lastEventIds[matrixIds[1]]) {
                    log.info("Immediate edit, deleting and re-sending");
                    await this.DeleteDiscordMessage(oldMsg);
                    await this.OnMessage(newMsg);
                    return;
                }
                link = `https://matrix.to/#/${matrixIds[1]}/${matrixIds[0]}`;
            }
        }

        // Create a new edit message using the old and new message contents
        const editedMsg = await this.discordMsgProcessor.FormatEdit(oldMsg, newMsg, link);

        // Send the message to all bridged matrix rooms
        if (!await this.SendMatrixMessage(editedMsg, newMsg.channel, newMsg.guild, newMsg.author, newMsg.id)) {
            log.error("Unable to announce message edit for msg id:", newMsg.id);
        }
    }

    private async DeleteDiscordMessage(msg: Discord.Message) {
        log.info(`Got delete event for ${msg.id}`);
        const storeEvent = await this.store.Get(DbEvent, {discord_id: msg.id});
        if (!storeEvent || !storeEvent.Result) {
            log.warn(`Could not redact because the event was not in the store.`);
            return;
        }
        while (storeEvent.Next()) {
            log.info(`Deleting discord msg ${storeEvent.DiscordId}`);
            const intent = this.GetIntentFromDiscordMember(msg.author, msg.webhookID);
            const matrixIds = storeEvent.MatrixId.split(";");
            try {
                await intent.getClient().redactEvent(matrixIds[1], matrixIds[0]);
            } catch (ex) {
                log.warn(`Failed to delete ${storeEvent.DiscordId}, retrying as bot`);
                try {
                    await this.bridge.getIntent().getClient().redactEvent(matrixIds[1], matrixIds[0]);
                } catch (ex) {
                    log.warn(`Failed to delete ${storeEvent.DiscordId}, giving up`);
                }
            }
        }
    }
}
