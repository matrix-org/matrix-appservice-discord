import { DiscordBridgeConfig } from "./config";
import { DiscordClientFactory } from "./clientfactory";
import { DiscordStore } from "./store";
import { DbEmoji } from "./db/dbdataemoji";
import { DbEvent } from "./db/dbdataevent";
import { MatrixUser, RemoteUser, Bridge, Entry } from "matrix-appservice-bridge";
import { Util } from "./util";
import { MessageProcessor, MessageProcessorOpts, MessageProcessorMatrixResult } from "./messageprocessor";
import { MatrixEventProcessor, MatrixEventProcessorOpts } from "./matrixeventprocessor";
import { PresenceHandler } from "./presencehandler";
import * as Discord from "discord.js";
import * as log from "npmlog";
import * as Bluebird from "bluebird";
import * as mime from "mime";
import { Provisioner } from "./provisioner";

// Due to messages often arriving before we get a response from the send call,
// messages get delayed from discord.
const MSG_PROCESS_DELAY = 750;
const MIN_PRESENCE_UPDATE_DELAY = 250;

// TODO: This is bad. We should be serving the icon from the own homeserver.
const MATRIX_ICON_URL = "https://matrix.org/_matrix/media/r0/download/matrix.org/mlxoESwIsTbJrfXyAAogrNxA";
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
  private mxEventProcessor: MatrixEventProcessor;
  private presenceHandler: PresenceHandler;

  constructor(config: DiscordBridgeConfig, store: DiscordStore, private provisioner: Provisioner) {
    this.config = config;
    this.store = store;
    this.sentMessages = [];
    this.clientFactory = new DiscordClientFactory(store, config.auth);
    this.msgProcessor = new MessageProcessor(
      new MessageProcessorOpts(this.config.bridge.domain, this),
    );
    this.presenceHandler = new PresenceHandler(this);
  }

  public setBridge(bridge: Bridge) {
    this.bridge = bridge;
    this.mxEventProcessor = new MatrixEventProcessor(
        new MatrixEventProcessorOpts(this.config, bridge),
    );
  }

  get ClientFactory(): DiscordClientFactory {
     return this.clientFactory;
  }

  public GetIntentFromDiscordMember(member: Discord.GuildMember | Discord.User): any {
      return this.bridge.getIntentFromLocalpart(`_discord_${member.id}`);
  }

  public run (): Promise<void> {
    return this.clientFactory.init().then(() => {
      return this.clientFactory.getClient();
    }).then((client: any) => {
      if (!this.config.bridge.disableTypingNotifications) {
        client.on("typingStart", (c, u) => { this.OnTyping(c, u, true); });
        client.on("typingStop", (c, u) => { this.OnTyping(c, u, false);  });
      }
      if (!this.config.bridge.disablePresence) {
        client.on("presenceUpdate", (_, newMember) => { this.presenceHandler.EnqueueMember(newMember); });
      }
      client.on("userUpdate", (_, newUser) => { this.UpdateUser(newUser); });
      client.on("channelUpdate", (_, newChannel) => { this.UpdateRooms(newChannel); });
      client.on("guildMemberAdd", (newMember) => { this.AddGuildMember(newMember); });
      client.on("guildMemberRemove", (oldMember) => { this.RemoveGuildMember(oldMember); });
      client.on("guildMemberUpdate", (_, newMember) => { this.UpdateGuildMember(newMember); });
      client.on("messageUpdate", (oldMessage, newMessage) => { this.OnMessageUpdate(oldMessage, newMessage); });
      client.on("messageDelete", (msg) => { this.DeleteDiscordMessage(msg); });
      client.on("message", (msg) => { Bluebird.delay(MSG_PROCESS_DELAY).then(() => {
          this.OnMessage(msg);
        });
      });
      client.on("debug", (msg) => { log.verbose("discord.js", msg); });
      client.on("error", (msg) => { log.error("discord.js", msg); });
      client.on("warn", (msg) => { log.warn("discord.js", msg); });
      log.info("DiscordBot", "Discord bot client logged in.");
      this.bot = client;

      if (!this.config.bridge.disablePresence) {
        if (!this.config.bridge.presenceInterval) {
          this.config.bridge.presenceInterval = MIN_PRESENCE_UPDATE_DELAY;
        }
        this.bot.guilds.forEach((guild) => {
            guild.members.forEach((member) => {
                this.presenceHandler.EnqueueMember(member);
            });
        });
        this.presenceHandler.Start(
            Math.max(this.config.bridge.presenceInterval, MIN_PRESENCE_UPDATE_DELAY),
        );
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

  public async ProcessMatrixMsgEvent(event: any, guildId: string, channelId: string): Promise<null> {
    const mxClient = this.bridge.getClientFactory().getClientAs();
    log.verbose("DiscordBot", `Looking up ${guildId}_${channelId}`);
    const result = await this.LookupRoom(guildId, channelId, event.sender);
    const chan = result.channel;
    const botUser = result.botUser;
    let profile = null;
    if (result.botUser) {
        // We are doing this through webhooks so fetch the user profile.
        profile = await mxClient.getStateEvent(event.room_id, "m.room.member", event.sender);
        if (profile === null) {
          log.warn("DiscordBot", `User ${event.sender} has no member state. That's odd.`);
        }
    }
    const embed = this.mxEventProcessor.EventToEmbed(event, profile, chan);
    const opts: Discord.MessageOptions = {};
    const file = await this.mxEventProcessor.HandleAttachment(event, mxClient);
    if (typeof(file) === "string") {
        embed.description += " " + file;
    } else {
        opts.file = file;
    }

    let msg = null;
    let hook: Discord.Webhook ;
    if (botUser) {
      const webhooks = await chan.fetchWebhooks();
      hook = webhooks.filterArray((h) => h.name === "_matrix").pop();
      // Create a new webhook if none already exists
      try {
        if (!hook) {
          hook = await chan.createWebhook("_matrix", MATRIX_ICON_URL, "Matrix Bridge: Allow rich user messages");
        }
      } catch (err) {
        log.error("DiscordBot", "Unable to create \"_matrix\" webhook. ", err);
      }
    }
    try {
      if (!botUser) {
        msg = await chan.send(embed.description, opts);
      } else if (hook) {
        msg = await hook.send(embed.description, {
            username: embed.author.name,
            avatarURL: embed.author.icon_url,
            file: opts.file,
        });
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
    if (this.config.bridge.disableDeletionForwarding) {
      return;
    }
    log.info("DiscordBot", `Got redact request for ${event.redacts}`);
    log.verbose("DiscordBot", `Event:`, event);
    const storeEvent = await this.store.Get(DbEvent, {matrix_id: event.redacts + ";" + event.room_id});
    if (!storeEvent.Result) {
      log.warn("DiscordBot", `Could not redact because the event was not in the store.`);
      return;
    }
    log.info("DiscordBot", `Redact event matched ${storeEvent.ResultCount} entries`);
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
      const msg = await channel.fetchMessage(storeEvent.DiscordId);
      try {
        await msg.delete();
        log.info("DiscordBot", `Deleted message`);
      } catch (ex) {
        log.warn("DiscordBot", `Failed to delete message`, ex);
      }
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
    const intent = this.GetIntentFromDiscordMember(member);
    return this.UpdateUser(member.user).then(() => {
      return Bluebird.each(roomIds, (roomId) => intent.join(roomId));
    }).then(() => {
      return this.UpdateGuildMember(member, roomIds);
    });
  }

  public async GetEmoji(name: string, animated: boolean, id: string): Promise<string> {
    if (!id.match(/^\d+$/)) {
      throw new Error("Non-numerical ID");
    }
    const dbEmoji: DbEmoji = await this.store.Get(DbEmoji, {emoji_id: id});
    if (!dbEmoji.Result) {
      const url = "https://cdn.discordapp.com/emojis/" + id + (animated ? ".gif" : ".png");
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

  private async SendMatrixMessage(matrixMsg: MessageProcessorMatrixResult, chan: Discord.Channel,
                                  guild: Discord.Guild, author: Discord.User,
                                  msgID: string): Promise<boolean> {
    const rooms = await this.GetRoomIdsFromChannel(chan);
    const intent = this.GetIntentFromDiscordMember(author);

    rooms.forEach((room) => {
      intent.sendMessage(room, {
        body: matrixMsg.body,
        msgtype: "m.text",
        formatted_body: matrixMsg.formattedBody,
        format: "org.matrix.custom.html",
      }).then((res) => {
        const evt = new DbEvent();
        evt.MatrixId = res.event_id + ";" + room;
        evt.DiscordId = msgID;
        evt.ChannelId = chan.id;
        evt.GuildId = guild.id;
        this.store.Insert(evt);
      });
    });

    // Sending was a success
    return Promise.resolve(true);
  }

  private AddGuildMember(guildMember: Discord.GuildMember) {
    return this.GetRoomIdsFromGuild(guildMember.guild.id).then((roomIds) => {
      return this.InitJoinUser(guildMember, roomIds);
    });
  }

  private RemoveGuildMember(guildMember: Discord.GuildMember) {
    const intent = this.GetIntentFromDiscordMember(guildMember);
    return Bluebird.each(this.GetRoomIdsFromGuild(guildMember.guild.id), (roomId) => {
        this.presenceHandler.DequeueMember(guildMember);
        return intent.leave(roomId);
    });
  }

  private UpdateGuildMember(guildMember: Discord.GuildMember, roomIds?: string[]) {
    const client = this.GetIntentFromDiscordMember(guildMember).getClient();
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
      const intent = this.GetIntentFromDiscordMember(user);
      return Promise.all(rooms.map((room) => {
        return intent.sendTyping(room, isTyping);
      }));
    }).catch((err) => {
      log.warn("DiscordBot", "Failed to send typing indicator.", err);
    });
  }

  private async OnMessage(msg: Discord.Message) {
    const indexOfMsg = this.sentMessages.indexOf(msg.id);
    const chan = <Discord.TextChannel> msg.channel;
    if (indexOfMsg !== -1) {
      log.verbose("DiscordBot", "Got repeated message, ignoring.");
      delete this.sentMessages[indexOfMsg];
      return; // Skip *our* messages
    }
    if (msg.author.id === this.bot.user.id) {
      // We don't support double bridging.
      return;
    }
    // Issue #57: Detect webhooks
    if (msg.webhookID != null) {
      const webhook = (await chan.fetchWebhooks())
                      .filterArray((h) => h.name === "_matrix").pop();
      if (webhook != null && msg.webhookID === webhook.id) {
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
          msg.channel.sendMessage("Thanks for your response! The matrix bridge has been approved");
        } else if (successfullyBridged && !isApproved) {
          msg.channel.sendMessage("Thanks for your response! The matrix bridge has been declined");
        } else {
          msg.channel.sendMessage("Thanks for your response, however the time for responses has expired - sorry!");
        }
      } catch (err) {
        if (err.message === "You do not have permission to manage webhooks in this channel") {
          msg.channel.sendMessage(err.message);
        } else {
          log.error("DiscordBot", "Error processing room approval");
          log.error("DiscordBot", err);
        }
      }

      return; // stop processing - we're approving/declining the bridge request
    }

    // Update presence because sometimes discord misses people.
    this.UpdateUser(msg.author).then(() => {
      return this.GetRoomIdsFromChannel(msg.channel).catch((err) => {
        log.verbose("DiscordBot", "No bridged rooms to send message to. Oh well.");
        return null;
      });
    }).then((rooms) => {
      if (rooms === null) {
        return null;
      }
      const intent = this.GetIntentFromDiscordMember(msg.author);
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
              external_url: attachment.url,
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

  private async OnMessageUpdate(oldMsg: Discord.Message, newMsg: Discord.Message) {
    // Check if an edit was actually made
    if (oldMsg.content === newMsg.content) {
      return;
    }

    // Create a new edit message using the old and new message contents
    const editedMsg = await this.msgProcessor.FormatEdit(oldMsg, newMsg);

    // Send the message to all bridged matrix rooms
    this.SendMatrixMessage(editedMsg, newMsg.channel, newMsg.guild, newMsg.author, newMsg.id);
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
          const intent = this.GetIntentFromDiscordMember(msg.author);
          const matrixIds = storeEvent.MatrixId.split(";");
          await intent.getClient().redactEvent(matrixIds[1], matrixIds[0]);
        }
    }
  }
