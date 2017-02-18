import { DiscordBridgeConfig } from "./config";
import * as Discord from "discord.js";
import * as log from "npmlog";
import { MatrixUser, RemoteUser } from "matrix-appservice-bridge";
import { Util } from "./util";

export class DiscordBot {
  private config: DiscordBridgeConfig;
  private bot: Discord.Client;
  private discord_user: Discord.ClientUser;
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
    // create an event listener for messages
    this.bot.on("message", (msg) => {
      if (msg.author.id === this.bot.user.id) {
        return; // Skip *our* messages
      }
      this.UpdateUser(msg.author).then(() => {
        return this.GetRoomIdFromChannel(msg.channel);
      }).then((room) => {
        const intent = this.bridge.getIntentFromLocalpart(`_discord_${msg.author.id}`);
        intent.sendText(room, msg.content);
      });
    });

    this.bot.login(this.config.auth.botToken);
  }

  public GetBot (): Discord.Client {
    return this.bot;
  }


  public LookupRoom (server: string, room: string): Promise<Discord.TextChannel> {
    const guild = this.bot.guilds.find((g) => {
      return (g.id === server || g.name.replace(" ", "-") === server);
    });
    if (guild === null) {
      return Promise.reject("Guild not found");
    }

    const channel = guild.channels.find((c) => {
      return ((c.id === room  || c.name.replace(" ", "-") === room ) && c.type === "text");
    });
    if (channel === null) {
      return Promise.reject("Channel not found");
    }
    return Promise.resolve(channel);

  }

  public ProcessMatrixMsgEvent(event, guild_id: string, channel_id: string): Promise<any> {
    if (event.content.msgtype !== "m.text") {
      return Promise.reject("The AS doesn't support non m.text messages");
    }
    let chan;
    const mxClient = this.bridge.getClientFactory().getClientAs();
    this.LookupRoom(guild_id, channel_id).then((channel) => {
      chan = channel;
      return mxClient.getProfileInfo(event.sender);
    }).then((profile) => {
      if (!profile.displayname) {
        profile.displayname = event.sender;
      }
      if (profile.avatar_url) {
        profile.avatar_url = mxClient.mxcUrlToHttp(profile.avatar_url);
      }
      const embed = new Discord.RichEmbed({
        author: {
          name: profile.displayname,
          icon_url: profile.avatar_url,
          url: `https://matrix.to/#/${event.sender}`,
          // TODO: Avatar
        },
        description: event.content.body,
      });
      log.info("DiscordBot", "Outgoing Message ", embed)
      chan.sendEmbed(embed);
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
        log.warn("DiscordBot", `Got message but couldn't find room chan id:${channel.id} for it.`);
        return Promise.reject("Room not found.");
      }
      return rooms[0].matrix.getId();
    });
  }

  private UpdateUser(discordUser: Discord.User) {
    let remoteUser: RemoteUser;
    const displayName = discordUser.username + "#" + discordUser.discriminator;
    const id = `_discord_${discordUser.id}:${this.config.bridge.domain}`;
    const intent = this.bridge.getIntent("@"+id);
    const userStore = this.bridge.getUserStore();

    return userStore.getRemoteUser(discordUser.id).then((u) => {
      remoteUser = u;
      console.log(remoteUser);
      if (remoteUser === null) {
        remoteUser = new RemoteUser(discordUser.id);
        return userStore.linkUsers(
          new MatrixUser(id),
          remoteUser
        );
      }
      return Promise.resolve();
    }).then(() => {
      console.log(remoteUser.get("displayname"), "!==", displayName);
      if (remoteUser.get("displayname") !== displayName) {
        return intent.setDisplayName(displayName).then(() => {
          remoteUser.set("displayname", displayName);
          return userStore.setRemoteUser(remoteUser);
        });
      }
      return true;
    }).then(() => {
      console.log(remoteUser.get("avatarurl"), "!==", discordUser.avatarURL);
      if (remoteUser.get("avatarurl") !== discordUser.avatarURL && discordUser.avatarURL !== null) {
        return Util.uploadContentFromUrl(this.bridge, discordUser.avatarURL, intent, discordUser.avatar).then((avatar) => {
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
}
