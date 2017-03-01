import { DiscordBridgeConfig } from "./config";
import { DiscordClientFactory } from "./clientfactory";
import { DiscordStore } from "./store";
import { DiscordDMHandler } from "./dmhandler";
import { MatrixUser, RemoteUser, Bridge, RemoteRoom } from "matrix-appservice-bridge";
import { Util } from "./util";
import * as Discord from "discord.js";
import * as log from "npmlog";
import * as Bluebird from "bluebird";
import * as mime from "mime";
import * as marked from "marked";
import * as path from "path";

// Due to messages often arriving before we get a response from the send call,
// messages get delayed from discord.
const MSG_PROCESS_DELAY = 750;
const MATRIX_TO_LINK = "https://matrix.to/#/";

class ChannelLookupResult {
  public channel: Discord.TextChannel;
  public botUser: boolean;
}

export class DiscordBot {
  private config: DiscordBridgeConfig;
  private clientFactory: DiscordClientFactory;
  private store: DiscordStore;
  private bot: Discord.Client;
  private discordUser: Discord.ClientUser;
  private bridge: Bridge;
  private sentMessages: string[];
  constructor(config: DiscordBridgeConfig, store: DiscordStore) {
    this.config = config;
    this.store = store;
    this.sentMessages = [];
    this.clientFactory = new DiscordClientFactory(config.auth, store);
  }

  public setBridge(bridge: Bridge) {
    this.bridge = bridge;
  }

  public run (): Promise<null> {
    return this.clientFactory.init().then(() => {
      return this.clientFactory.getClient();
    }).then((client: any) => {
      client.on("typingStart", (c, u) => { this.OnTyping(c, u, true); });
      client.on("typingStop", (c, u) => { this.OnTyping(c, u, false); });
      client.on("userUpdate", (_, newUser) => { this.UpdateUser(newUser); });
      client.on("channelUpdate", (_, newChannel) => { this.UpdateRoom(<Discord.TextChannel> newChannel); });
      client.on("presenceUpdate", (_, newMember) => { this.UpdatePresence(newMember); });
      client.on("message", (msg) => { Bluebird.delay(MSG_PROCESS_DELAY).then(() => {
          this.OnMessage(msg);
        });
      });
      this.bot = client;
      return null;
    });
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
      log.warn("DiscordBot", "Tried to do a third party lookup for a channel, but the guild did not exist");
      return [];
    }
  }

  public LookupRoom (server: string, room: string, sender?: string): Promise<ChannelLookupResult> {
    let hasSender = sender !== null;
    return this.clientFactory.getClient(sender).then((client) => {
      const guild = client.guilds.get(server);
      if (!guild) {
        return Promise.reject(`Guild "${server}" not found`);
      }
      const channel = guild.channels.get(room);
      if (channel) {
        const lookupResult = new ChannelLookupResult();
        lookupResult.channel = channel;
        lookupResult.botUser = this.bot.user.id === client.user.id;
        return lookupResult;
      }
      return Promise.reject(`Channel "${room}" not found`);
    }).catch((err) => {
      log.verbose("DiscordBot", "LookupRoom => ", err);
      if (hasSender) {
        log.verbose("DiscordBot", `Couldn't find guild/channel under user account. Falling back.`);
        return this.LookupRoom(server, room, null);
      }
      throw err;
    });
  }

  public ProcessMatrixMsgEvent(event, guildId: string, channelId: string): Promise<any> {
    let chan;
    let embed;
    let botUser;
    const mxClient = this.bridge.getClientFactory().getClientAs();
    log.verbose("DiscordBot", `Looking up ${guildId}_${channelId}`);
    return this.LookupRoom(guildId, channelId, event.sender).then((result) => {
      log.verbose("DiscordBot", `Found channel! Looking up ${event.sender}`);
      chan = result.channel;
      botUser = result.botUser;
      log.verbose("DiscordBot", botUser);
      if (result.botUser) {
        return mxClient.getProfileInfo(event.sender);
      }
      return null;
    }).then((profile) => {
      if (botUser === true) {
        if (!profile.displayname) {
          profile.displayname = event.sender;
        }
        if (profile.avatar_url) {
          profile.avatar_url = mxClient.mxcUrlToHttp(profile.avatar_url);
        }
        embed = new Discord.RichEmbed({
          author: {
            name: profile.displayname,
            icon_url: profile.avatar_url,
            url: `https://matrix.to/#/${event.sender}`,
            // TODO: Avatar
          },
          description: event.content.body,
        });
      }
      if (["m.image", "m.audio", "m.video", "m.file"].indexOf(event.content.msgtype) !== -1) {
        return Util.DownloadFile(mxClient.mxcUrlToHttp(event.content.url));
      }
      return Promise.resolve(null);
    }).then((attachment) => {
      if (attachment !== null) {
        let name = this.GetFilenameForMediaEvent(event.content);
        return {
          file : {
            name,
            attachment,
          },
        };
      }
      return {};
    }).then((opts) => {
      if (botUser) {
        return chan.sendEmbed(embed, opts);
      }
      return chan.sendMessage(event.content.body, opts);
    }).then((msg) => {
      this.sentMessages.push(msg.id);
    }).catch((err) => {
      log.error("DiscordBot", "Couldn't send message. ", err);
    });
  }

  public OnUserQuery (userId: string): any {
    return false;
  }

  private GetFilenameForMediaEvent(content) {
    if (content.body) {
      if (path.extname(content.body) !== "") {
        return content.body;
      }
      return path.basename(content.body) + "." + mime.extension(content.mimetype);
    }
    return "matrix-media." + mime.extension(content.mimetype);
  }

  private GetRoomIdFromChannel(channel: Discord.Channel): Promise<string> {
    return this.bridge.getRoomStore().getEntriesByRemoteRoomData({
      discord_channel: channel.id,
    }).then((rooms) => {
      if (rooms.length === 0) {
        log.verbose("DiscordBot", `Got message but couldn"t find room chan id:${channel.id} for it.`);
        return Promise.reject("Room not found.");
      }
      return rooms[0].matrix.getId();
    });
  }

  private UpdateRoom(discordChannel: Discord.TextChannel): Promise<null> {
    const intent = this.bridge.getIntent();
    const roomStore = this.bridge.getRoomStore();
    let entry: RemoteRoom;
    let roomId = null;
    return this.GetRoomIdFromChannel(discordChannel).then((r) => {
      roomId = r;
      return roomStore.getEntriesByMatrixId(roomId);
    }).then((entries) => {
      if (entries.length === 0) {
        return Promise.reject("Couldn't update room for channel, no assoicated entry in roomstore.");
      }
      entry = entries[0];
      return;
    }).then(() => {
      const name = `[Discord] ${discordChannel.guild.name} #${discordChannel.name}`;
      if (entry.remote.get("discord_name") !== name) {
        return intent.setRoomName(roomId, name).then(() => {
          entry.remote.set("discord_name", name);
          return roomStore.upsertEntry(entry);
        });
      }
    }).then(() => {
      if (entry.remote.get("discord_topic") !== discordChannel.topic) {
        return intent.setRoomTopic(roomId, discordChannel.topic).then(() => {
          entry.remote.set("discord_topic", discordChannel.topic);
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
          this.bridge,
          discordUser.avatarURL,
          intent,
          discordUser.avatar,
        ).then((avatar) => {
          intent.setAvatarUrl(avatar.mxc_url).then(() => {
            remoteUser.set("avatarurl", discordUser.avatarURL);
            return userStore.setRemoteUser(remoteUser);
          });
        });
      }
      return true;
    });
  }

  private UpdatePresence(guildMember: Discord.GuildMember) {
    log.info("DiscordBot", `Updating presence for ${guildMember.user.username}#${guildMember.user.discriminator}`);
    const intent = this.bridge.getIntentFromLocalpart(`_discord_${guildMember.id}`);
    try {
      let presence = guildMember.presence.status;
      if (presence === "idle" || presence === "dnd") {
        presence = "unavailable";
      }
      intent.getClient().setPresence({
        presence,
      });
    } catch (err) {
      log.info("DiscordBot", "Couldn't set presence ", err);
    }
    // TODO: Set nicknames inside the scope of guild chats.
  }

  private OnTyping(channel: Discord.Channel, user: Discord.User, isTyping: boolean) {
    return this.GetRoomIdFromChannel(channel).then((room) => {
      const intent = this.bridge.getIntentFromLocalpart(`_discord_${user.id}`);
      return intent.sendTyping(room, isTyping);
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
      let memberId = `@_discord_${id}:${this.config.bridge.domain}`;
      let memberStr = member ? member.user.username : memberId;
      content = content.replace(results[0], `[${memberStr}](${MATRIX_TO_LINK}${memberId})`);
      results = userRegex.exec(content);
    }
    // Replace channels
    const channelRegex = /<#?([0-9]*)>/g;
    results = channelRegex.exec(content);
    while (results !== null) {
      const id = results[1];
      const channel = msg.guild.channels.get(id);
      let roomId = `#_discord_${msg.guild.id}_${id}:${this.config.bridge.domain}`;
      let channelStr = channel ? "#" + channel.name : "#" + id;
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
    this.UpdateUser(msg.author).then(() => {
      return this.GetRoomIdFromChannel(msg.channel);
    }).then((room) => {
      const intent = this.bridge.getIntentFromLocalpart(`_discord_${msg.author.id}`);
      // Check Attachements
      msg.attachments.forEach((attachment) => {
        Util.UploadContentFromUrl(this.bridge, attachment.url, intent, attachment.filename).then((content) => {
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
          intent.sendMessage(room, {
            body: attachment.filename,
            info,
            msgtype,
            url: content.mxc_url,
          });
        });
      });
      if (msg.content !== null && msg.content !== "") {
        // Replace mentions.
        let content = this.FormatDiscordMessage(msg);
        intent.sendMessage(room, {
          body: content,
          msgtype: "m.text",
          formatted_body: marked(content),
          format: "org.matrix.custom.html",
        });
      }
    }).catch((err) => {
      log.warn("DiscordBot", "Failed to send message into room.", err);
    });
  }
}
