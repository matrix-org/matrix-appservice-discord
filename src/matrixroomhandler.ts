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

import * as Discord from "discord.js";
import * as log from "npmlog";
import * as Bluebird from "bluebird";

const ICON_URL = "https://matrix.org/_matrix/media/r0/download/matrix.org/mlxoESwIsTbJrfXyAAogrNxA";
const JOIN_DELAY = 6000;
const HTTP_UNSUPPORTED = 501;
const ROOM_NAME_PARTS = 2;
const AGE_LIMIT = 900000; // 15 * 60 * 1000

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

    public async OnAliasQueried (alias: string, roomId: string) {
        log.info("MatrixRoomHandler", `OnAliasQueried for ${roomId}`);
        const bot = this.bridge.getIntent();
        let entries = await this.bridge.getRoomStore().getEntriesByMatrixId(roomId);
        if (entries.length > 0) {
            if (entries[0].remote.get("discord_type") == "dm") {
                const user = entries[0].remote.get("user1_mxid");
                log.info("DiscordBot", `Inviting user ${user}`);
                await bot.invite(roomId, user);
                return this.discord.GetChannelFromRoomId(roomId).then((channel: Discord.DMChannel) => {
                    return this.discord.InitJoinUserDm(channel.recipient, roomId);
                });
            }
        }
    // Join a whole bunch of users.
    let promiseChain: any = Bluebird.resolve();
    let delay = JOIN_DELAY; /* We delay the joins to give some implmentations a chance to breathe */
    return this.discord.GetChannelFromRoomId(roomId).then((channel: Discord.Channel) => {
      for (const member of (<Discord.TextChannel> channel).guild.members.array()) {
        if (member.id === this.discord.GetBotId()) {
          continue;
        }
        promiseChain = promiseChain.return(Bluebird.delay(delay).then(() => {
          return this.discord.InitJoinUser(member, [roomId]);
        }));
        delay += JOIN_DELAY;
      }
    }).catch((err) => {
        log.warn("MatrixRoomHandler", "OnAliasQueried => %s", err);
    });
  }

  public OnEvent (request, context) {
    const event = request.getData();
    if (event.unsigned.age > AGE_LIMIT) {
      log.warn("MatrixRoomHandler", "Skipping event due to age %s > %s", event.unsigned.age, AGE_LIMIT);
      return;
    }
    if (event.type === "m.room.member" && event.content.membership === "invite") {
      this.HandleInvite(event);
    } else if (event.type === "m.room.redaction" && context.rooms.remote) {
      this.discord.ProcessMatrixRedact(event);
    } else if (event.type === "m.room.message" && context.rooms.remote) {
        log.verbose("MatrixRoomHandler", `Got m.room.message event`);
        const srvChanPair = context.rooms.remote.roomId.substr("discord_".length).split("_");
        if (srvChanPair[0] == "dm") {
            return this.discord.ProcessMatrixMsgEvent(event, srvChanPair[1], srvChanPair[2], true).catch((err) => {
                log.warn("MatrixRoomHandler", "There was an error sending a matrix DM event", err);
            });
        }
        return this.discord.ProcessMatrixMsgEvent(event, srvChanPair[0], srvChanPair[1], false).catch((err) => {
            log.warn("MatrixRoomHandler", "There was an error sending a matrix event", err);
      });
    } else {
      log.verbose("MatrixRoomHandler", "Got non m.room.message event");
    }
  }

  public HandleInvite(event: any) {
    // Do nothing yet.
  }

  public OnAliasQuery (alias: string, aliasLocalpart: string): Promise<any> {
    log.info("MatrixRoomHandler", "Got request for #", aliasLocalpart);
    const srvChanPair = aliasLocalpart.substr("_discord_".length).split("_");
    if (srvChanPair.length < ROOM_NAME_PARTS || srvChanPair[0] === "" || srvChanPair[1] === "") {
      log.warn("MatrixRoomHandler", `Alias '${aliasLocalpart}' was missing a server and/or a channel`);
      return;
    }
      if (srvChanPair[0] == "dm") {
          if (srvChanPair.length < 3 || srvChanPair[2] === "") {
              log.warn("MatrixRoomHandler", `Alias '${aliasLocalpart}' was missing a 2nd user`);
              return;
          }
          return this.discord.LookupDmRoom(srvChanPair[1], srvChanPair[2]).then((result) => {
              log.info("MatrixRoomHandler", "Creating DM room #", aliasLocalpart);
              return this.createMatrixDmRoom(result.channel, result.user, srvChanPair[1], srvChanPair[2], aliasLocalpart);
          }).catch((err) => {
              log.error("MatrixRoomHandler", `Couldn't find discord DM room '${aliasLocalpart}'.`, err);
          });
      }
      else {
          return this.discord.LookupRoom(srvChanPair[0], srvChanPair[1]).then((result) => {
              log.info("MatrixRoomHandler", "Creating #", aliasLocalpart);
              return this.createMatrixRoom(result.channel, aliasLocalpart);
          }).catch((err) => {
              log.error("MatrixRoomHandler", `Couldn't find discord room '${aliasLocalpart}'.`, err);
          });
      }
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
    return Promise.reject({err: "Unsupported", code: HTTP_UNSUPPORTED});
  }

  public tpGetUser(protocol: string, fields: any): Promise<thirdPartyUserResult[]> {
    log.info("MatrixRoomHandler", "Got user request ", protocol, fields);
    return Promise.reject({err: "Unsupported", code: HTTP_UNSUPPORTED});
  }

  public tpParseUser(userid: string): Promise<thirdPartyUserResult[]> {
    return Promise.reject({err: "Unsupported", code: HTTP_UNSUPPORTED});
  }
    private createMatrixDmRoom (channel: Discord.DMChannel, mxuser1: string, user1: string, user2: string, alias: string) {
        const remote = new RemoteRoom(alias.substr(1));
        remote.set("discord_type", "dm");
        remote.set("discord_channel", channel.id);
        remote.set("user1_mxid", mxuser1);
        remote.set("discord_user1", user1);
        remote.set("discord_user2", user2);
        remote.set("update_name", true);
        remote.set("update_topic", true);
        const creationOpts = {
            visibility: "private",
            room_alias_name: alias,
            name: `${channel.recipient.username}#${channel.recipient.discriminator} (DM on Discord)`,
            topic: "",
            preset: "trusted_private_chat",
            is_direct: true
        };
        return {
            creationOpts,
            remote,
        };
    }
  private createMatrixRoom (channel: Discord.TextChannel, alias: string) {
    const remote = new RemoteRoom(`discord_${channel.guild.id}_${channel.id}`);
    remote.set("discord_type", "text");
    remote.set("discord_guild", channel.guild.id);
    remote.set("discord_channel", channel.id);
    remote.set("update_name", true);
    remote.set("update_topic", true);
    const creationOpts = {
      visibility: this.config.room.defaultVisibility,
      room_alias_name: alias,
      name: `#${channel.name} (${channel.guild.name} on Discord)`,
      topic: channel.topic ? channel.topic : "",
      initial_state: [
        {
          type: "m.room.join_rules",
          content: {
            join_rule: "public",
          },
          state_key: "",
        },
      ],
    };
    return {
      creationOpts,
      remote,
    };
  }
}
