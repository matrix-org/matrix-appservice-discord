import { DiscordBridgeConfig } from "./config";
import { DiscordClientFactory } from "./clientfactory";
import { DiscordStore } from "./store";
import { MatrixUser, RemoteUser, Bridge, Entry } from "matrix-appservice-bridge";
import { Util } from "./util";
import * as Discord from "discord.js";
import * as log from "npmlog";
import * as Bluebird from "bluebird";
import * as mime from "mime";
import * as marked from "marked";
import * as path from "path";
import * as escapeStringRegexp from "escape-string-regexp";

// Due to messages often arriving before we get a response from the send call,
// messages get delayed from discord.
const MSG_PROCESS_DELAY = 750;
const MATRIX_TO_LINK = "https://matrix.to/#/";
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
  constructor(config: DiscordBridgeConfig, store: DiscordStore) {
    this.config = config;
    this.store = store;
    this.sentMessages = [];
    this.clientFactory = new DiscordClientFactory(store, config.auth);
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
      client.on("typingStart", (c, u) => { this.OnTyping(c, u, true); });
      client.on("typingStop", (c, u) => { this.OnTyping(c, u, false); });
      client.on("userUpdate", (_, newUser) => { this.UpdateUser(newUser); });
      client.on("channelUpdate", (_, newChannel) => { this.UpdateRooms(newChannel); });
      client.on("presenceUpdate", (_, newMember) => { this.UpdatePresence(newMember); });
      client.on("guildMemberUpdate", (_, newMember) => { this.UpdateGuildMember(newMember); });
      client.on("message", (msg) => { Bluebird.delay(MSG_PROCESS_DELAY).then(() => {
          this.OnMessage(msg);
        });
      });
      log.info("DiscordBot", "Discord bot client logged in.");
      this.bot = client;
      /* Currently synapse sadly times out presence after a minute.
       * This will set the presence for each user who is not offline */
      this.presenceInterval = setInterval(
        this.BulkPresenceUpdate.bind(this),
        PRESENCE_UPDATE_DELAY,
      );
      this.BulkPresenceUpdate();
      return null;
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
    if(profile) {
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
        description: this.HandleMentions(event.content.body, channel.members.array()),
      });
    }
    return new Discord.RichEmbed({
      description: this.HandleMentions(event.content.body, channel.members.array()),
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
    let opts : Discord.MessageOptions = {};
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
    let hook : Discord.Webhook ;
    if(botUser) {
      const webhooks = await chan.fetchWebhooks();
      hook = webhooks.filterArray((h) => h.name === "_matrix").pop();
    }
    try {
      if (!botUser) {
        msg = await chan.send(embed.description, opts);
      } else if (hook && !hasAttachment) { //Remove !hasAttachment and uncomment below when https://github.com/hydrabolt/discord.js/pull/1449 is fixed
        const hookOpts : Discord.WebhookMessageOptions = {
          username: embed.author.name,
          avatarURL: embed.author.icon_url,
        };
        //if (hasAttachment) {
        //  hookOpts.file = opts.file;
        //  msg = await hook.send(embed.description, hookOpts);
        //} else {
        msg = await hook.send(embed.description, hookOpts);
        //}
      } else {
        opts.embed = embed;
        msg = await chan.send("", opts);
      }
    } catch (err) {
      log.error("DiscordBot", "Couldn't send message. ", err);
    }
    if (Array.isArray(msg)) {
      msg.forEach((m) => { this.sentMessages.push(m.id); });
      return;
    }
    this.sentMessages.push(msg.id);
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

  private GetFilenameForMediaEvent(content): string {
    if (content.body) {
      if (path.extname(content.body) !== "") {
        return content.body;
      }
      return path.basename(content.body) + "." + mime.extension(content.info.mimetype);
    }
    return "matrix-media." + mime.extension(content.info.mimetype);
  }

  private HandleMentions(body: string, members: Discord.GuildMember[]): string {
    for (const member of members) {
      body = body.replace(new RegExp(escapeStringRegexp(member.displayName), "g"), `<@!${member.id}>`);
    }
    return body;
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

  private UpdateGuildMember(guildMember: Discord.GuildMember) {
    const client = this.bridge.getIntentFromLocalpart(`_discord_${guildMember.id}`).getClient();
    const userId = client.credentials.userId;
    let avatar = null;
    log.info(`Updating nick for ${guildMember.user.username}`);
    Bluebird.each(client.getProfileInfo(userId, "avatar_url").then((avatarUrl) => {
      avatar = avatarUrl.avatar_url;
      return this.GetRoomIdsFromGuild(guildMember.guild.id);
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

  private FormatDiscordMessage(msg: Discord.Message): string {
    // Replace Users
    let content = msg.content;
    const userRegex = /<@!?([0-9]*)>/g;
    let results = userRegex.exec(content);
    while (results !== null) {
      const id = results[1];
      const member = msg.guild.members.get(id);
      const memberId = `@_discord_${id}:${this.config.bridge.domain}`;
      const memberStr = member ? member.user.username : memberId;
      content = content.replace(results[0], memberStr);
      results = userRegex.exec(content);
    }
    // Replace channels
    const channelRegex = /<#?([0-9]*)>/g;
    results = channelRegex.exec(content);
    while (results !== null) {
      const id = results[1];
      const channel = msg.guild.channels.get(id);
      const roomId = `#_discord_${msg.guild.id}_${id}:${this.config.bridge.domain}`;
      const channelStr = channel ? "#" + channel.name : "#" + id;
      content = content.replace(results[0], `[${channelStr}](${MATRIX_TO_LINK}${roomId})`);
      results = channelRegex.exec(content);
    }
    return content;
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
        // Replace mentions.
        const content = this.FormatDiscordMessage(msg);
        const fBody = marked(content);
        rooms.forEach((room) => {
          intent.sendMessage(room, {
            body: content,
            msgtype: "m.text",
            formatted_body: fBody,
            format: "org.matrix.custom.html",
          });
        });
      }
    }).catch((err) => {
      log.verbose("DiscordBot", "Failed to send message into room.", err);
    });
  }
}
