import { DiscordBridgeConfig } from "./config";
import * as Discord from "discord.js";
import * as log from "npmlog";
import { MatrixUser, RemoteUser } from "matrix-appservice-bridge";
import { Util } from "./util";
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

  public run () {
    this.bot = new Discord.Client();

    this.bot.on("ready", () => {
      log.info("DiscordBot", "I am ready!");
    });

    this.bot.on("typingStart", (c, u) => { this.OnTyping(c, u, true); });
    this.bot.on("typingStop", (c, u) => { this.OnTyping(c, u, false); });
    this.bot.on("message", this.OnMessage.bind(this));
    this.bot.login(this.config.auth.botToken);
  }

  public GetBot (): Discord.Client {
    return this.bot;
  }

  public LookupRoom (server: string, room: string): Promise<Discord.TextChannel> {
    const guild = this.bot.guilds.find((g) => {
      return (g.id === server || g.name.toLowerCase().replace(/ /g, "-") === server.toLowerCase());
    });
    if (guild === null) {
      return Promise.reject(`Guild "${server}" not found`);
    }

    const channel = guild.channels.find((c) => {
      return ((c.id === room  || c.name.toLowerCase().replace(/ /g, "-") === room.toLowerCase() ) && c.type === "text");
    });
    if (channel === null) {
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

  private OnTyping(channel: Discord.Channel, user: Discord.User, isTyping: boolean) {
    this.GetRoomIdFromChannel(channel).then((room) => {
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
          })
        } else {
          // Plain text
          intent.sendText(room, msg.content);
        }
      }
    });
  }
}
