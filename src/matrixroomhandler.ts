import { DiscordBot } from "./bot";
import {
  Bridge,
  RemoteRoom,
  thirdPartyLookup,
  thirdPartyProtocolResult,
  thirdPartyUserResult,
  thirdPartyLocationResult,
 } from "matrix-appservice-bridge";
import { DiscordBridgeConfig } from "./config";
import { DiscordClientFactory } from "./clientfactory";

import * as Discord from "discord.js";
import * as log from "npmlog";

const ICON_URL = "https://matrix.org/_matrix/media/r0/download/matrix.org/mlxoESwIsTbJrfXyAAogrNxA";

export class MatrixRoomHandler {
  private config: DiscordBridgeConfig;
  private bridge: Bridge;
  private discord: DiscordBot;
  private botUserId: string;
  constructor (discord: DiscordBot, config: DiscordBridgeConfig, botUserId: string) {
    this.discord = discord;
    this.config = config;
    this.botUserId = botUserId;
  }

  public get ThirdPartyLookup(): thirdPartyLookup {
    return {
      protocols: ["discord"],
      getProtocol: this.tpGetProtocol.bind(this),
      getLocation: this.tpGetLocation.bind(this),
      parseLocation: this.tpParseLocation.bind(this),
      getUser: this.tpGetUser.bind(this),
      parseUser: this.tpParseUser.bind(this),
    };
  }

  public setBridge(bridge: Bridge) {
    this.bridge = bridge;
  }

  public OnAliasQueried (alias: string, roomId: string) {
    return; // We don't use this.
  }

  public OnEvent (request, context) {
    const event = request.getData();
    if (event.type === "m.room.message" && context.rooms.remote) {
      log.verbose("MatrixRoomHandler", "Got m.room.message event");
      let srvChanPair = context.rooms.remote.roomId.substr("_discord".length).split("_", 2);
      this.discord.ProcessMatrixMsgEvent(event, srvChanPair[0], srvChanPair[1]);
    } else {
      log.verbose("MatrixRoomHandler", "Got non m.room.message event");
    }
  }

  public OnAliasQuery (alias: string, aliasLocalpart: string): Promise<any> {
    log.info("MatrixRoomHandler", "Got request for #", aliasLocalpart);
    let srvChanPair = aliasLocalpart.substr("_discord_".length).split("_", 2);
    if (srvChanPair.length < 2 || srvChanPair[0] === "" || srvChanPair[1] === "") {
      log.warn("MatrixRoomHandler", `Alias '${aliasLocalpart}' was missing a server and/or a channel`);
      return;
    }
    return this.discord.LookupRoom(srvChanPair[0], srvChanPair[1]).then((result) => {
      log.info("MatrixRoomHandler", "Creating #", aliasLocalpart);
      return this.createMatrixRoom(result.channel, aliasLocalpart);
    }).catch((err) => {
      log.error("MatrixRoomHandler", `Couldn't find discord room '${aliasLocalpart}'.`, err);
    });
  }

  public tpGetProtocol(protocol: string): Promise<thirdPartyProtocolResult> {
    return Promise.resolve({
      user_fields: ["username", "discriminator"],
      location_fields: ["guild_id", "channel_name"],
      field_types: {
        // guild_name: {
        //   regexp: "\S.{0,98}\S",
        //   placeholder: "Guild",
        // },
        guild_id: {
          regexp: "[0-9]*",
          placeholder: "",
        },
        channel_id: {
          regexp: "[0-9]*",
          placeholder: "",
        },
        channel_name: {
           regexp: "[A-Za-z0-9_\-]{2,100}",
           placeholder: "#Channel",
        },
        username: {
          regexp: "[A-Za-z0-9_\-]{2,100}",
          placeholder: "Username",
        },
        discriminator: {
          regexp: "[0-9]{4}",
          placeholder: "1234",
        },
      },
      instances: this.discord.GetGuilds().map((guild) => {
        return {
          network_id: guild.id,
          bot_user_id: this.botUserId,
          desc: guild.name,
          icon: guild.iconURL || ICON_URL, // TODO: Use icons from our content repo. Potential security risk.
          fields: {
            guild_id: guild.id,
          },
        };
      }),
    });
  }

  public tpGetLocation(protocol: string, fields: any): Promise<thirdPartyLocationResult[]> {
    log.info("MatrixRoomHandler", "Got location request ", protocol, fields);
    const chans = this.discord.ThirdpartySearchForChannels(fields.guild_id, fields.channel_name);
    return Promise.resolve(chans);
  }

  public tpParseLocation(alias: string): Promise<thirdPartyLocationResult[]>  {
    return Promise.reject({err: "Unsupported", code: 501});
  }

  public tpGetUser(protocol: string, fields: any): Promise<thirdPartyUserResult[]> {
    log.info("MatrixRoomHandler", "Got user request ", protocol, fields);
    return Promise.reject({err: "Unsupported", code: 501});
  }

  public tpParseUser(userid: string): Promise<thirdPartyUserResult[]> {
    return Promise.reject({err: "Unsupported", code: 501});
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

    const creationOpts = {
      visibility: "public",
      room_alias_name: alias,
      name: `[Discord] ${channel.guild.name} #${channel.name}`,
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
        },
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
