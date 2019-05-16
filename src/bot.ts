/*
Copyright 2017 - 2019 matrix-appservice-discord

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
import { MatrixEventProcessor, MatrixEventProcessorOpts, IMatrixEventProcessorResult } from "./matrixeventprocessor";
import { PresenceHandler } from "./presencehandler";
import { Provisioner } from "./provisioner";
import { UserSyncroniser } from "./usersyncroniser";
import { ChannelSyncroniser } from "./channelsyncroniser";
import { MatrixRoomHandler } from "./matrixroomhandler";
import { Log } from "./log";
import * as Discord from "discord.js";
import * as mime from "mime";
import { IMatrixEvent, IMatrixMediaInfo } from "./matrixtypes";
import { DiscordCommandHandler } from "./discordcommandhandler";

const log = new Log("DiscordBot");

const MIN_PRESENCE_UPDATE_DELAY = 250;
const CACHE_LIFETIME = 90000;

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
    private clientFactory: DiscordClientFactory;
    private bot: Discord.Client;
    private presenceInterval: number;
    private sentMessages: string[];
    private lastEventIds: { [channelId: string]: string };
    private discordMsgProcessor: DiscordMessageProcessor;
    private mxEventProcessor: MatrixEventProcessor;
    private presenceHandler: PresenceHandler;
    private userSync!: UserSyncroniser;
    private channelSync: ChannelSyncroniser;
    private roomHandler: MatrixRoomHandler;
    private provisioner: Provisioner;
    private discordCommandHandler: DiscordCommandHandler;
    /* Caches */
    private roomIdsForGuildCache: Map<string, {roomIds: string[], ts: number}> = new Map();

    /* Handles messages queued up to be sent to matrix from discord. */
    private discordMessageQueue: { [channelId: string]: Promise<void> };
    private channelLocks: { [channelId: string]: {p: Promise<{}>, i: NodeJS.Timeout} };

    constructor(
        private botUserId: string,
        private config: DiscordBridgeConfig,
        private bridge: Bridge,
        private store: DiscordStore,
    ) {

        // create handlers
        this.clientFactory = new DiscordClientFactory(store, config.auth);
        this.discordMsgProcessor = new DiscordMessageProcessor(
            new DiscordMessageProcessorOpts(config.bridge.domain, this),
        );
        this.presenceHandler = new PresenceHandler(this);
        this.roomHandler = new MatrixRoomHandler(this, config, this.provisioner, bridge, store.roomStore);
        this.channelSync = new ChannelSyncroniser(bridge, config, this, store.roomStore);
        this.provisioner = new Provisioner(store.roomStore, this.channelSync);
        this.mxEventProcessor = new MatrixEventProcessor(
            new MatrixEventProcessorOpts(config, bridge, this),
        );
        this.discordCommandHandler = new DiscordCommandHandler(bridge, this);
        // init vars
        this.sentMessages = [];
        this.discordMessageQueue = {};
        this.channelLocks = {};
        this.lastEventIds = {};
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

    get BotUserId(): string {
        return this.botUserId;
    }

    get RoomHandler(): MatrixRoomHandler {
        return this.roomHandler;
    }

    get MxEventProcessor(): MatrixEventProcessor {
        return this.mxEventProcessor;
    }

    get Provisioner(): Provisioner {
        return this.provisioner;
    }

    public lockChannel(channel: Discord.Channel) {
        if (this.channelLocks[channel.id]) {
            return;
        }
        let i: NodeJS.Timeout;
        const p = new Promise((resolve) => {
            i = setInterval(resolve, this.config.limits.discordSendDelay);
            this.channelLocks[channel.id] = {i, p};
        });
    }

    public unlockChannel(channel: Discord.Channel) {
        const lock = this.channelLocks[channel.id];
        if (lock) {
            clearTimeout(lock.i);
        }
        delete this.channelLocks[channel.id];
    }

    public async waitUnlock(channel: Discord.Channel) {
        const lock = this.channelLocks[channel.id];
        if (lock) {
            await lock.p;
        }
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

    public async init(): Promise<void> {
        await this.clientFactory.init();
        // This immediately pokes UserStore, so it must be created after the bridge has started.
        this.userSync = new UserSyncroniser(this.bridge, this.config, this, this.store.userStore);
    }

    public async run(): Promise<void> {
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
        // messages get delayed from discord. We use Util.DelayedPromise to handle this.

        client.on("messageDelete", async (msg: Discord.Message) => {
            try {
                await this.waitUnlock(msg.channel);
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
        client.on("messageDeleteBulk", async (msgs: Discord.Collection<Discord.Snowflake, Discord.Message>) => {
            try {
                await Util.DelayedPromise(this.config.limits.discordSendDelay);
                const promiseArr: (() => Promise<void>)[] = [];
                msgs.forEach((msg) => {
                    promiseArr.push(async () => {
                        try {
                            await this.waitUnlock(msg.channel);
                            await this.DeleteDiscordMessage(msg);
                        } catch (err) {
                            log.error("Caught while handling 'messageDeleteBulk'", err);
                        }
                    });
                });
                await Promise.all(promiseArr);
            } catch (err) {
                log.error("Exception thrown while handling \"messageDeleteBulk\" event", err);
            }
        });
        client.on("messageUpdate", async (oldMessage: Discord.Message, newMessage: Discord.Message) => {
            try {
                await this.waitUnlock(newMessage.channel);
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
                await this.waitUnlock(msg.channel);
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

    public async sendAsBot(msg: string, channel: Discord.TextChannel, event: IMatrixEvent): Promise<void> {
        if (!msg) {
            return;
        }
        this.lockChannel(channel);
        const res = await channel.send(msg);
        this.unlockChannel(channel);
        await this.StoreMessagesSent(res, channel, event);
    }

    public async send(
        embedSet: IMatrixEventProcessorResult,
        opts: Discord.MessageOptions,
        roomLookup: ChannelLookupResult,
        event: IMatrixEvent,
    ): Promise<void> {
        const chan = roomLookup.channel;
        const botUser = roomLookup.botUser;
        const embed = embedSet.messageEmbed;

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
            this.lockChannel(chan);
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
            this.unlockChannel(chan);
            await this.StoreMessagesSent(msg, chan, event);
        } catch (err) {
            log.error("Couldn't send message. ", err);
        }
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
                this.lockChannel(msg.channel);
                await msg.delete();
                this.unlockChannel(msg.channel);
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
        const entries = await this.store.roomStore.getEntriesByMatrixId(
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
        if (!entry.remote) {
            throw Error("Room had no remote component");
        }
        const guild = client.guilds.get(entry.remote!.get("discord_guild") as string);
        if (guild) {
            const channel = client.channels.get(entry.remote!.get("discord_channel") as string);
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

    public async GetRoomIdsFromGuild(
            guild: Discord.Guild, member?: Discord.GuildMember, useCache: boolean = true): Promise<string[]> {
        if (useCache) {
            const res = this.roomIdsForGuildCache.get(`${guild.id}:${member ? member.id : ""}`);
            if (res && res.ts > Date.now() - CACHE_LIFETIME) {
                return res.roomIds;
            }
        }

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
            this.roomIdsForGuildCache.set(`${guild.id}:${guild.member}`, {roomIds: rooms, ts: Date.now()});
            return rooms;
        } else {
            const rooms = await this.store.roomStore.getEntriesByRemoteRoomData({
                discord_guild: guild.id,
            });
            if (rooms.length === 0) {
                log.verbose(`Couldn't find room(s) for guild id:${guild.id}.`);
                throw new Error("Room(s) not found.");
            }
            const roomIds = rooms.map((room) => room.matrix!.getId());
            this.roomIdsForGuildCache.set(`${guild.id}:`, {roomIds, ts: Date.now()});
            return roomIds;
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
            this.lockChannel(botChannel);
            res = await botChannel.send(
                `${kickee} was unbanned from this channel by ${kicker}.`,
            ) as Discord.Message;
            this.unlockChannel(botChannel);
            this.sentMessages.push(res.id);
            return;
        }
        const existingPerms = tchan.memberPermissions(kickee);
        if (existingPerms && existingPerms.has(Discord.Permissions.FLAGS.VIEW_CHANNEL as number) === false ) {
            log.warn("User isn't allowed to read anyway.");
            return;
        }
        const word = `${kickban === "ban" ? "banned" : "kicked"}`;
        this.lockChannel(botChannel);
        res = await botChannel.send(
            `${kickee} was ${word} from this channel by ${kicker}.`
            + (reason ? ` Reason: ${reason}` : ""),
        ) as Discord.Message;
        this.unlockChannel(botChannel);
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

        // check if it is a command to process by the bot itself
        if (msg.content.startsWith("!matrix")) {
            await this.discordCommandHandler.Process(msg);
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
                        log.error("Failed to send message into room.", e);
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

    private async StoreMessagesSent(
        msg: Discord.Message | null | (Discord.Message | null)[],
        chan: Discord.TextChannel,
        event: IMatrixEvent,
    ) {
        if (!Array.isArray(msg)) {
            msg = [msg];
        }
        await Util.AsyncForEach(msg, async (m: Discord.Message) => {
            if (!m) {
                return;
            }
            log.verbose("Sent ", m.id);
            this.sentMessages.push(m.id);
            this.lastEventIds[event.room_id] = event.event_id;
            try {
                const evt = new DbEvent();
                evt.MatrixId = `${event.event_id};${event.room_id}`;
                evt.DiscordId = m.id;
                evt.GuildId = chan.guild.id;
                evt.ChannelId = chan.id;
                await this.store.Insert(evt);
            } catch (err) {
                log.error(`Failed to insert sent event (${event.event_id};${event.room_id}) into store`, err);
            }
        });
    }
}
