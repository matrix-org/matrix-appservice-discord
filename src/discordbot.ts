import { DiscordBridgeConfig } from "./config";
import * as Discord from "discord.js";
import * as log from "npmlog";
import { MatrixUser, RemoteUser } from "matrix-appservice-bridge";
import { Util } from "./util";
import * as Bluebird from "bluebird";
import * as mime from "mime";
import * as marked from "marked";

export class DiscordBot {
  private config: DiscordBridgeConfig;
  private bot: Discord.Client;
  private discordUser: Discord.ClientUser;
  private bridge;
  constructor(config: DiscordBridgeConfig, bridge) {
    this.config = config;
    this.bridge = bridge;
  }

  public run (): Promise<null> {
    this.bot = Bluebird.promisifyAll(new Discord.Client());
    this.bot.on("typingStart", (c, u) => { this.OnTyping(c, u, true); });
    this.bot.on("typingStop", (c, u) => { this.OnTyping(c, u, false); });
    this.bot.on("userUpdate", (_, newUser) => { this.UpdateUser(newUser); });
    this.bot.on("channelUpdate", (_, newChannel) => { this.UpdateRoom(<Discord.TextChannel> newChannel); });
    this.bot.on("presenceUpdate", (_, newMember) => { this.UpdatePresence(newMember); });
    this.bot.on("message", this.OnMessage.bind(this));
    const promise = (this.bot as any).onAsync("ready");
    this.bot.login(this.config.auth.botToken);

    return promise;
  }

  public GetBot (): Discord.Client {
    return this.bot;
  }

  public LookupRoom (server: string, room: string): Promise<Discord.TextChannel> {
    const guild = this.bot.guilds.find((g) => {
      return (g.id === server || g.name.toLowerCase().replace(/ /g, "-") === server.toLowerCase());
    });
    if (!guild) {
      return Promise.reject(`Guild "${server}" not found`);
    }

    const channel = guild.channels.find((c) => {
      return ((c.id === room  || c.name.toLowerCase() === room.toLowerCase() ) && c.type === "text");
    });

    if (!channel) {
      return Promise.reject(`Channel "${room}" not found`);
    }
    return Promise.resolve(channel);

  }

  public ProcessMatrixMsgEvent(event, guildId: string, channelId: string): Promise<any> {
    let chan;
    let embed;
    const mxClient = this.bridge.getClientFactory().getClientAs();
    return this.LookupRoom(guildId, channelId).then((channel) => {
      chan = channel;
      return mxClient.getProfileInfo(event.sender);
    }).then((profile) => {
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
      if (["m.image", "m.audio", "m.video", "m.file"].indexOf(event.content.msgtype) !== -1) {
        return Util.DownloadFile(mxClient.mxcUrlToHttp(event.content.url));
      }
      return Promise.resolve(null);
    }).then((attachment) => {
      if (attachment !== null) {
        return {
          file : {
            name: event.content.body,
            attachment,
          },
        };
      }
      return {};
    }).then((opts) => {
      chan.sendEmbed(embed, opts);
    }).catch((err) => {
      log.error("DiscordBot", "Couldn't send message. ", err);
    });
  }

  public OnUserQuery (userId: string): any {
    return false;
  }

  private GetRoomIdFromChannel(channel: Discord.Channel): Promise<string> {
    return this.bridge.getRoomStore().getEntriesByRemoteRoomData({
      discord_channel: channel.id,
    }).then((rooms) => {
      if (rooms.length === 0) {
        log.warn("DiscordBot", `Got message but couldn"t find room chan id:${channel.id} for it.`);
        return Promise.reject("Room not found.");
      }
      return rooms[0].matrix.getId();
    });
  }

  private UpdateRoom(discordChannel: Discord.TextChannel): Promise<null> {
    const intent = this.bridge.getIntent();
    const roomStore = this.bridge.getRoomStore();
    let roomId = null;
    return this.GetRoomIdFromChannel(discordChannel).then((r) => {
      roomId = r;
      return roomStore.getEntriesByMatrixId(roomId);
    }).then((entries) => {
      if (entries.length === 0) {
        return Promise.reject("Couldn't update room for channel, no assoicated entry in roomstore.");
      }
      return entries[0];
    }).then((entry) => {
      const name = `[Discord] ${discordChannel.guild.name}#${discordChannel.name}`;
      if (entry.remote.get("discord_name") !== name) {
        return intent.setRoomName(roomId).then(() => {
          entry.remote.set("discord_name", name);
          return roomStore.upsurtEntry(entry);
        });
      }
    }).then((entry) => {
      if (entry.remote.get("discord_topic") !== discordChannel.topic) {
        return intent.setRoomTopic(roomId).then(() => {
          entry.remote.set("discord_topic", discordChannel.topic);
          return roomStore.upsurtEntry(entry);
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
      intent.sendTyping(room, isTyping);
    });
  }

  private OnMessage(msg: Discord.Message) {
    if (msg.author.id === this.bot.user.id) {
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
        const markdown = marked(msg.content);
        if (markdown !== msg.content) {
          // Markdown message
          intent.sendMessage(room, {
            body: msg.content,
            msgtype: "m.text",
            formatted_body: markdown,
            format: "org.matrix.custom.html",
          });
        } else {
          // Plain text
          intent.sendText(room, msg.content);
        }
      }
    });
  }
}
