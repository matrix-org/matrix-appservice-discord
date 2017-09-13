import { DiscordBridgeConfig } from "./config";
import { DiscordClientFactory } from "./clientfactory";
import { DiscordStore } from "./store";
import { DbGuildEmoji } from "./db/dbdataemoji";
import { DbEvent } from "./db/dbdataevent";
import { MatrixUser, RemoteUser, Bridge, Entry } from "matrix-appservice-bridge";
import { Util } from "./util";
import { MessageProcessor, MessageProcessorOpts } from "./messageprocessor";
import * as Discord from "discord.js";
import * as log from "npmlog";
import * as Bluebird from "bluebird";
import * as mime from "mime";
import * as path from "path";

// Due to messages often arriving before we get a response from the send call,
// messages get delayed from discord.
const MSG_PROCESS_DELAY = 750;
const PRESENCE_UPDATE_DELAY = 55000; // Synapse updates in 55 second intervals.
class ChannelLookupResult {
  public channel: Discord.TextChannel;
  public botUser: boolean;
}

export class DiscordBot {
  private config: DiscordBridgeConfig;
  private clientFactory: DiscordClientFactory;
  private store: DiscordStore;
  private bot: Discord.Client;
  private bridge: Bridge;
  private presenceInterval: any;
  private sentMessages: string[];
  private msgProcessor: MessageProcessor;
  constructor(config: DiscordBridgeConfig, store: DiscordStore) {
    this.config = config;
    this.store = store;
    this.sentMessages = [];
    this.clientFactory = new DiscordClientFactory(store, config.auth);
    this.msgProcessor = new MessageProcessor(
        new MessageProcessorOpts(this.config.bridge.domain),
        this,
    );
  }

  public setBridge(bridge: Bridge) {
    this.bridge = bridge;
  }

  get ClientFactory(): DiscordClientFactory {
     return this.clientFactory;
  }

  public run (): Promise<null> {
    return this.clientFactory.init().then(() => {
      return this.clientFactory.getClient();
    }).then((client: any) => {
      if (!this.config.bridge.disableTypingNotifications) {
        client.on("typingStart", (c, u) => { this.OnTyping(c, u, true); });
        client.on("typingStop", (c, u) => { this.OnTyping(c, u, false);  });
      }
      if (!this.config.bridge.disablePresence) {
        client.on("presenceUpdate", (_, newMember) => { this.UpdatePresence(newMember); });
      }
      client.on("userUpdate", (_, newUser) => { this.UpdateUser(newUser); });
      client.on("channelUpdate", (_, newChannel) => { this.UpdateRooms(newChannel); });
      client.on("guildMemberAdd", (newMember) => { this.AddGuildMember(newMember); });
      client.on("guildMemberRemove", (oldMember) => { this.RemoveGuildMember(oldMember); });
      client.on("guildMemberUpdate", (_, newMember) => { this.UpdateGuildMember(newMember); });
      client.on("messageDelete", (msg) => {this.DeleteDiscordMessage(msg); });
      client.on("message", (msg) => { Bluebird.delay(MSG_PROCESS_DELAY).then(() => {
          this.OnMessage(msg);
        });
      });
      log.info("DiscordBot", "Discord bot client logged in.");
      this.bot = client;

      if (!this.config.bridge.disablePresence) {
        /* Currently synapse sadly times out presence after a minute.
         * This will set the presence for each user who is not offline */
        this.presenceInterval = setInterval(
            this.BulkPresenceUpdate.bind(this),
            PRESENCE_UPDATE_DELAY,
        );
        this.BulkPresenceUpdate();
        return null;
      }
    });
  }

  public GetBotId(): string {
    return this.bot.user.id;
  }

  public GetGuilds(): Discord.Guild[] {
    return this.bot.guilds.array();
  }

  public ThirdpartySearchForChannels(guildId: string, channelName: string): any[] {
    if (channelName.startsWith("#")) {
      channelName = channelName.substr(1);
    }
    if (this.bot.guilds.has(guildId) ) {
      const guild = this.bot.guilds.get(guildId);
      return guild.channels.filter((channel) => {
        return channel.name.toLowerCase() === channelName.toLowerCase(); // Implement searching in the future.
      }).map((channel) => {
        return {
          alias: `#_discord_${guild.id}_${channel.id}:${this.config.bridge.domain}`,
          protocol: "discord",
          fields: {
            guild_id: guild.id,
            channel_name: channel.name,
            channel_id: channel.id,
          },
        };
      });
    } else {
      log.info("DiscordBot", "Tried to do a third party lookup for a channel, but the guild did not exist");
      return [];
    }
  }

  public LookupRoom (server: string, room: string, sender?: string): Promise<ChannelLookupResult> {
    const hasSender = sender !== null;
    return this.clientFactory.getClient(sender).then((client) => {
      const guild = client.guilds.get(server);
      if (!guild) {
        throw `Guild "${server}" not found`;
      }
      const channel = guild.channels.get(room);
      if (channel) {
        const lookupResult = new ChannelLookupResult();
        lookupResult.channel = channel;
        lookupResult.botUser = this.bot.user.id === client.user.id;
        return lookupResult;
      }
      throw `Channel "${room}" not found`;
    }).catch((err) => {
      log.verbose("DiscordBot", "LookupRoom => ", err);
      if (hasSender) {
        log.verbose("DiscordBot", `Couldn't find guild/channel under user account. Falling back.`);
        return this.LookupRoom(server, room, null);
      }
      throw err;
    });
  }

  public MatrixEventToEmbed(event: any, profile: any, channel: Discord.TextChannel): Discord.RichEmbed {
    const body = this.config.bridge.disableDiscordMentions ? event.content.body :
                 this.msgProcessor.FindMentionsInPlainBody(
                     event.content.body,
                     channel.members.array(),
                 );
    if (profile) {
      profile.displayname = profile.displayname || event.sender;
      if (profile.avatar_url) {
        const mxClient = this.bridge.getClientFactory().getClientAs();
        profile.avatar_url = mxClient.mxcUrlToHttp(profile.avatar_url);
      }
      return new Discord.RichEmbed({
        author: {
          name: profile.displayname,
          icon_url: profile.avatar_url,
          url: `https://matrix.to/#/${event.sender}`,
        },
        description: body,
      });
    }
    return new Discord.RichEmbed({
      description: body,
    });
  }

  public async ProcessMatrixMsgEvent(event: any, guildId: string, channelId: string): Promise<null> {
    const mxClient = this.bridge.getClientFactory().getClientAs();
    log.verbose("DiscordBot", `Looking up ${guildId}_${channelId}`);
    const result = await this.LookupRoom(guildId, channelId, event.sender);
    log.verbose("DiscordBot", `Found channel! Looking up ${event.sender}`);
    const chan = result.channel;
    const botUser = result.botUser;
    const profile = result.botUser ? await mxClient.getProfileInfo(event.sender) : null;
    const embed = this.MatrixEventToEmbed(event, profile, chan);
    const opts: Discord.MessageOptions = {};
    const hasAttachment = ["m.image", "m.audio", "m.video", "m.file"].indexOf(event.content.msgtype) !== -1;
    if (hasAttachment) {
      const attachment = await Util.DownloadFile(mxClient.mxcUrlToHttp(event.content.url));
      const name = this.GetFilenameForMediaEvent(event.content);
      opts.file = {
        name,
        attachment,
      };
    }
    let msg = null;
    let hook: Discord.Webhook ;
    if (botUser) {
      const webhooks = await chan.fetchWebhooks();
      hook = webhooks.filterArray((h) => h.name === "_matrix").pop();
    }
    try {
      if (!botUser) {
        msg = await chan.send(embed.description, opts);
      } else if (hook && !hasAttachment) {
        const hookOpts: Discord.WebhookMessageOptions = {
          username: embed.author.name,
          avatarURL: embed.author.icon_url,
        };
        // Uncomment this and remove !hasAttachment above after https://github.com/hydrabolt/discord.js/pull/1449 pulled
        // if (hasAttachment) {
        //   hookOpts.file = opts.file;
        //   msg = await hook.send(embed.description, hookOpts);
        // } else {
        msg = await hook.send(embed.description, hookOpts);
        // }
      } else {
        opts.embed = embed;
        msg = await chan.send("", opts);
      }
    } catch (err) {
      log.error("DiscordBot", "Couldn't send message. ", err);
    }
    if (!Array.isArray(msg)) {
        msg = [msg];
    }
    msg.forEach((m: Discord.Message) => {
      log.verbose("DiscordBot", "Sent ", m);
      this.sentMessages.push(m.id);
      const evt = new DbEvent();
      evt.MatrixId = event.event_id + ";" + event.room_id;
      evt.DiscordId = m.id;
      // Webhooks don't send guild info.
      evt.GuildId = guildId;
      evt.ChannelId = channelId;
      this.store.Insert(evt);
    });
    return;
  }

  public async ProcessMatrixRedact(event: any) {
    log.info("DiscordBot", `Got redact request for ${event.redacts}`);
    log.verbose("DiscordBot", `Event:`, event);
    const storeEvent = await this.store.Get(DbEvent, {matrix_id: event.redacts + ";" + event.room_id});
    if (!storeEvent.Result) {
        log.warn("DiscordBot", `Could not redact because the event was in the store.`);
        return;
    }
    while (storeEvent.Next()) {
        log.info("DiscordBot", `Deleting discord msg ${storeEvent.DiscordId}`);
        if (!this.bot.guilds.has(storeEvent.GuildId)) {
            log.warn("DiscordBot", `Could not redact because the guild could not be found.`);
            return;
        }
        if (!this.bot.guilds.get(storeEvent.GuildId).channels.has(storeEvent.ChannelId)) {
            log.warn("DiscordBot", `Could not redact because the guild could not be found.`);
            return;
        }
        const channel = <Discord.TextChannel> this.bot.guilds.get(storeEvent.GuildId)
                        .channels.get(storeEvent.ChannelId);
        await channel.fetchMessage(storeEvent.DiscordId);
    }
  }

  public OnUserQuery (userId: string): any {
    return false;
  }

  public GetChannelFromRoomId(roomId: string): Promise<Discord.Channel> {
    return this.bridge.getRoomStore().getEntriesByMatrixId(
      roomId,
    ).then((entries) => {
      if (entries.length === 0) {
        log.verbose("DiscordBot", `Couldn"t find channel for roomId ${roomId}.`);
        return Promise.reject("Room(s) not found.");
      }
      const entry = entries[0];
      const guild = this.bot.guilds.get(entry.remote.get("discord_guild"));
      if (guild) {
        const channel = this.bot.channels.get(entry.remote.get("discord_channel"));
        if (channel) {
          return channel;
        }
        throw Error("Channel given in room entry not found");
      }
      throw Error("Guild given in room entry not found");
    });
  }

  public InitJoinUser(member: Discord.GuildMember, roomIds: string[]): Promise<any> {
    const intent = this.bridge.getIntentFromLocalpart(`_discord_${member.id}`);
    return this.UpdateUser(member.user).then(() => {
      return Bluebird.each(roomIds, (roomId) => intent.join(roomId));
    }).then(() => {
      return this.UpdateGuildMember(member, roomIds);
    });
  }

  public async GetGuildEmoji(guild: Discord.Guild, id: string): Promise<string> {
      const dbEmoji: DbGuildEmoji = await this.store.Get(DbGuildEmoji, {emoji_id: id});
      if (!dbEmoji.Result) {
          // Fetch the emoji
          if (!guild.emojis.has(id)) {
              throw new Error("The guild does not contain the emoji");
          }
          const emoji: Discord.Emoji = guild.emojis.get(id);
          const intent = this.bridge.getIntent();
          const mxcUrl = (await Util.UploadContentFromUrl(emoji.url, intent, emoji.name)).mxcUrl;
          dbEmoji.EmojiId = emoji.id;
          dbEmoji.GuildId = guild.id;
          dbEmoji.Name = emoji.name;
          dbEmoji.MxcUrl = mxcUrl;
          await this.store.Insert(dbEmoji);
      }
      return dbEmoji.MxcUrl;
  }

  private GetFilenameForMediaEvent(content): string {
    if (content.body) {
      if (path.extname(content.body) !== "") {
        return content.body;
      }
      return path.basename(content.body) + "." + mime.extension(content.info.mimetype);
    }
    return "matrix-media." + mime.extension(content.info.mimetype);
  }

  private GetRoomIdsFromChannel(channel: Discord.Channel): Promise<string[]> {
    return this.bridge.getRoomStore().getEntriesByRemoteRoomData({
      discord_channel: channel.id,
    }).then((rooms) => {
      if (rooms.length === 0) {
        log.verbose("DiscordBot", `Couldn"t find room(s) for channel ${channel.id}.`);
        return Promise.reject("Room(s) not found.");
      }
      return rooms.map((room) => room.matrix.getId() as string);
    });
  }

  private GetRoomIdsFromGuild(guild: String): Promise<string[]> {
    return this.bridge.getRoomStore().getEntriesByRemoteRoomData({
      discord_guild: guild,
    }).then((rooms) => {
      if (rooms.length === 0) {
        log.verbose("DiscordBot", `Couldn"t find room(s) for guild id:${guild}.`);
        return Promise.reject("Room(s) not found.");
      }
      return rooms.map((room) => room.matrix.getId());
    });
  }

  private UpdateRooms(discordChannel: Discord.Channel) {
    if (discordChannel.type !== "text") {
      return; // Not supported for now.
    }
    log.info("DiscordBot", `Updating ${discordChannel.id}`);
    const textChan = (<Discord.TextChannel> discordChannel);
    const roomStore = this.bridge.getRoomStore();
    this.GetRoomIdsFromChannel(textChan).then((rooms) => {
      return roomStore.getEntriesByMatrixIds(rooms).then( (entries) => {
        return Object.keys(entries).map((key) => entries[key]);
      });
    }).then((entries: any) => {
      return Promise.all(entries.map((entry) => {
        if (entry.length === 0) {
          throw Error("Couldn't update room for channel, no assoicated entry in roomstore.");
        }
        return this.UpdateRoomEntry(entry[0], textChan);
      }));
    }).catch((err) => {
      log.error("DiscordBot", "Error during room update %s", err);
    });
  }

  private UpdateRoomEntry(entry: Entry, discordChannel: Discord.TextChannel): Promise<null> {
    const intent = this.bridge.getIntent();
    const roomStore = this.bridge.getRoomStore();
    const roomId = entry.matrix.getId();
    return new Promise(() => {
      const name = `[Discord] ${discordChannel.guild.name} #${discordChannel.name}`;
      if (entry.remote.get("update_name") && entry.remote.get("discord_name") !== name) {
        return intent.setRoomName(roomId, name).then(() => {
          log.info("DiscordBot", `Updated name for ${roomId}`);
          entry.remote.set("discord_name", name);
          return roomStore.upsertEntry(entry);
        });
      }
    }).then(() => {
      if ( entry.remote.get("update_topic") && entry.remote.get("discord_topic") !== discordChannel.topic) {
        return intent.setRoomTopic(roomId, discordChannel.topic).then(() => {
          entry.remote.set("discord_topic", discordChannel.topic);
          log.info("DiscordBot", `Updated topic for ${roomId}`);
          return roomStore.upsertEntry(entry);
        });
      }
    });
  }

  private UpdateUser(discordUser: Discord.User) {
    let remoteUser: RemoteUser;
    const displayName = discordUser.username + "#" + discordUser.discriminator;
    const id = `_discord_${discordUser.id}:${this.config.bridge.domain}`;
    const intent = this.bridge.getIntent("@" + id);
    const userStore = this.bridge.getUserStore();

    return userStore.getRemoteUser(discordUser.id).then((u) => {
      remoteUser = u;
      if (remoteUser === null) {
        remoteUser = new RemoteUser(discordUser.id);
        return userStore.linkUsers(
          new MatrixUser(id),
          remoteUser,
        );
      }
      return Promise.resolve();
    }).then(() => {
      if (remoteUser.get("displayname") !== displayName) {
        return intent.setDisplayName(displayName).then(() => {
          remoteUser.set("displayname", displayName);
          return userStore.setRemoteUser(remoteUser);
        });
      }
      return true;
    }).then(() => {
      if (remoteUser.get("avatarurl") !== discordUser.avatarURL && discordUser.avatarURL !== null) {
        return Util.UploadContentFromUrl(
          discordUser.avatarURL,
          intent,
          discordUser.avatar,
        ).then((avatar) => {
          intent.setAvatarUrl(avatar.mxcUrl).then(() => {
            remoteUser.set("avatarurl", discordUser.avatarURL);
            return userStore.setRemoteUser(remoteUser);
          });
        });
      }
      return true;
    });
  }

  private BulkPresenceUpdate() {
    if (this.config.bridge.disablePresence) {
      return; // skip if there's nothing to do
    }

    log.verbose("DiscordBot", "Bulk presence update");
    const members = [];
    for (const guild of this.bot.guilds.values()) {
      for (const member of guild.members.array().filter((m) => members.indexOf(m.id) === -1)) {
        /* We ignore offline because they are likely to have been set
         * by a 'presenceUpdate' event or will timeout. This saves
         * some work on the HS */
        if (member.presence.status !== "offline") {
          this.UpdatePresence(member);
        }
        members.push(member.id);
      }
    }
}

  private UpdatePresence(guildMember: Discord.GuildMember) {
    if (this.config.bridge.disablePresence) {
      return; // skip if there's nothing to do
    }

    const intent = this.bridge.getIntentFromLocalpart(`_discord_${guildMember.id}`);
    try {
      const presence: any = {};
      presence.presence = guildMember.presence.status;
      if (presence.presence === "idle" || presence.presence === "dnd") {
        presence.presence = "unavailable";
      }
      if (guildMember.presence.game) {
        presence.status_msg = "Playing " + guildMember.presence.game.name;
      }
      intent.getClient().setPresence(presence);
    } catch (err) {
      log.info("DiscordBot", "Couldn't set presence ", err);
    }
  }

  private AddGuildMember(guildMember: Discord.GuildMember) {
    return this.GetRoomIdsFromGuild(guildMember.guild.id).then((roomIds) => {
      return this.InitJoinUser(guildMember, roomIds);
    });
  }

  private RemoveGuildMember(guildMember: Discord.GuildMember) {
    const intent = this.bridge.getIntentFromLocalpart(`_discord_${guildMember.id}`);
    return Bluebird.each(this.GetRoomIdsFromGuild(guildMember.guild.id), (roomId) => {
      return intent.leave(roomId);
    });
  }

  private UpdateGuildMember(guildMember: Discord.GuildMember, roomIds?: string[]) {
    const client = this.bridge.getIntentFromLocalpart(`_discord_${guildMember.id}`).getClient();
    const userId = client.credentials.userId;
    let avatar = null;
    log.info(`Updating nick for ${guildMember.user.username}`);
    Bluebird.each(client.getProfileInfo(userId, "avatar_url").then((avatarUrl) => {
      avatar = avatarUrl.avatar_url;
      return roomIds || this.GetRoomIdsFromGuild(guildMember.guild.id);
    }), (room) => {
      log.verbose(`Updating ${room}`);
      client.sendStateEvent(room, "m.room.member", {
        membership: "join",
        avatar_url: avatar,
        displayname: guildMember.displayName,
      }, userId);
    }).catch((err) => {
      log.error("DiscordBot", "Failed to update guild member %s", err);
    });
  }

  private OnTyping(channel: Discord.Channel, user: Discord.User, isTyping: boolean) {
    this.GetRoomIdsFromChannel(channel).then((rooms) => {
      const intent = this.bridge.getIntentFromLocalpart(`_discord_${user.id}`);
      return Promise.all(rooms.map((room) => {
        return intent.sendTyping(room, isTyping);
      }));
    }).catch((err) => {
      log.verbose("DiscordBot", "Failed to send typing indicator.", err);
    });
  }

  private OnMessage(msg: Discord.Message) {
    const indexOfMsg = this.sentMessages.indexOf(msg.id);
    if (indexOfMsg !== -1) {
      log.verbose("DiscordBot", "Got repeated message, ignoring.");
      delete this.sentMessages[indexOfMsg];
      return; // Skip *our* messages
    }
    if (msg.author.id === this.bot.user.id) {
      // We don't support double bridging.
      return;
    }
    // Update presence because sometimes discord misses people.
    this.UpdatePresence(msg.member);
    this.UpdateUser(msg.author).then(() => {
      return this.GetRoomIdsFromChannel(msg.channel).catch((err) => {
        log.verbose("DiscordBot", "No bridged rooms to send message to. Oh well.");
        return null;
      });
    }).then((rooms) => {
      if (rooms === null) {
        return null;
      }
      const intent = this.bridge.getIntentFromLocalpart(`_discord_${msg.author.id}`);
      // Check Attachements
      msg.attachments.forEach((attachment) => {
        Util.UploadContentFromUrl(attachment.url, intent, attachment.filename).then((content) => {
          const fileMime = mime.lookup(attachment.filename);
          const msgtype = attachment.height ? "m.image" : "m.file";
          const info = {
            mimetype: fileMime,
            size: attachment.filesize,
            w: null,
            h: null,
          };
          if (msgtype === "m.image") {
            info.w = attachment.width;
            info.h = attachment.height;
          }
          rooms.forEach((room) => {
            intent.sendMessage(room, {
              body: attachment.filename,
              info,
              msgtype,
              url: content.mxcUrl,
            });
          });
        });
      });
      if (msg.content !== null && msg.content !== "") {
        this.msgProcessor.FormatDiscordMessage(msg).then((result) => {
            rooms.forEach((room) => {
              intent.sendMessage(room, {
                body: result.body,
                msgtype: "m.text",
                formatted_body: result.formattedBody,
                format: "org.matrix.custom.html",
            }).then((res) => {
                    const evt = new DbEvent();
                    evt.MatrixId = res.event_id + ";" + room;
                    evt.DiscordId = msg.id;
                    evt.ChannelId = msg.channel.id;
                    evt.GuildId = msg.guild.id;
                    this.store.Insert(evt);
                });
            });
        });
      }
    }).catch((err) => {
      log.verbose("DiscordBot", "Failed to send message into room.", err);
    });
  }

    private async DeleteDiscordMessage(msg: Discord.Message) {
        log.info("DiscordBot", `Got delete event for ${msg.id}`);
        const storeEvent = await this.store.Get(DbEvent, {discord_id: msg.id});
        if (!storeEvent.Result) {
          log.warn("DiscordBot", `Could not redact because the event was in the store.`);
          return;
        }
        while (storeEvent.Next()) {
          log.info("DiscordBot", `Deleting discord msg ${storeEvent.DiscordId}`);
          const client = this.bridge.getIntent().getClient();
          const matrixIds = storeEvent.MatrixId.split(";");
          await client.redactEvent(matrixIds[1], matrixIds[0]);
        }
    }
}
