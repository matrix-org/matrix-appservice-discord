import { DiscordBot } from "./discordbot";
import { Bridge, RemoteRoom } from "matrix-appservice-bridge";
import { DiscordBridgeConfig } from "./config";

import * as Discord from "discord.js";
import * as log from "npmlog";

export class MatrixRoomHandler {
  private config: DiscordBridgeConfig;
  private bridge: Bridge;
  private discord: DiscordBot;
  private alias_list: any;
  constructor (bridge: Bridge, discord: DiscordBot, config: DiscordBridgeConfig) {
    this.bridge = bridge;
    this.discord = discord;
    this.config = config;
    this.alias_list = {};
  }

  public OnAliasQueried (alias: string, roomId: string) {
    const aliasLocalpart = alias.substr(1, alias.length - `:${this.config.bridge.domain}`.length - 1);
    log.info("MatrixRoomHandler", `Room created ${aliasLocalpart} => ${roomId}`);
    if (this.alias_list[aliasLocalpart] == null) {
      log.warn("MatrixRoomHandler", "Room was created but we couldn't assign additonal aliases");
      return;
    }
    const mxClient = this.bridge.getClientFactory().getClientAs();
    this.alias_list[aliasLocalpart].forEach((item) => {
      if (item === "#" + aliasLocalpart) {
        return;
      }
      mxClient.createAlias(item, roomId).catch( (err) => {
        log.warn("MatrixRoomHandler", `Failed to create alias '${aliasLocalpart} for ${roomId}'`, err);
      });
    });
    delete this.alias_list[aliasLocalpart];
  }

  public OnEvent (request, context) {
    console.log(context);
    const event = request.getData();
    if (event.type === "m.room.message" && context.rooms.remote) {
      let srvChanPair = context.rooms.remote.roomId.substr("_discord".length).split("_", 2);
      this.discord.ProcessMatrixMsgEvent(event, srvChanPair[0], srvChanPair[1]);
    }
  }

  public OnAliasQuery (alias: string, aliasLocalpart: string): Promise<any> {
    let srvChanPair = aliasLocalpart.substr("_discord_".length).split("_", 2);
    if (srvChanPair.length < 2 || srvChanPair[0] === "" || srvChanPair[1] === "") {
      log.warn("MatrixRoomHandler", `Alias '${aliasLocalpart}' was missing a server and/or a channel`);
      return;
    }
    return this.discord.LookupRoom(srvChanPair[0], srvChanPair[1]).then((channel) => {
      return this.createMatrixRoom(channel, aliasLocalpart);
    }).catch((err) => {
      log.error("MatrixRoomHandler", `Couldn't find discord room '${aliasLocalpart}'.`, err);
    });
  }

  private createMatrixRoom (channel: Discord.TextChannel, alias: string) {
    const botID = this.bridge.getBot().getUserId();
    // const roomOwner = "@_discord_" + user.id_str + ":" + this._bridge.opts.domain;
    const users = {};
    users[botID] = 100;
    // users[roomOwner] = 75;
    // var powers = util.roomPowers(users);
    const remote = new RemoteRoom(`discord_${channel.guild.id}_${channel.id}`);
    remote.set("discord_type", "text");
    remote.set("discord_guild", channel.guild.id);
    remote.set("discord_channel", channel.id);

    const gname = channel.guild.name.replace(" ", "-");
    const cname = channel.name.replace(" ", "-");

    this.alias_list[alias] = [
      `#_discord_${channel.guild.id}_${channel.id}:${this.config.bridge.domain}`,
      `#_discord_${channel.guild.id}_${cname}:${this.config.bridge.domain}`,
      `#_discord_${gname}_${channel.id}:${this.config.bridge.domain}`,
      `#_discord_${gname}_${cname}:${this.config.bridge.domain}`,
    ];

    const creationOpts = {
      visibility: "public",
      room_alias_name: alias,
      name: `[Discord] ${channel.guild.name}#${channel.name}`,
      topic: channel.topic ? channel.topic : "",
      // invite: [roomOwner],
      initial_state: [
        // powers,
        {
          type: "m.room.join_rules",
          content: {
            join_rule: "public",
          },
          state_key: "",
        }
        // }, {
        //   type: "org.matrix.twitter.data",
        //   content: user,
        //   state_key: ""
        // }, {
        //   type: "m.room.avatar",
        //   state_key: "",
        //   content: {
        //     url: avatar
        //   }
      ],
    };
    return {
      creationOpts,
      remote,
    };
  }
}
