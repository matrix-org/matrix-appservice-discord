import { DiscordBot } from "./bot";
import {
  Bridge,
  RemoteRoom,
  MatrixRoom,
  thirdPartyLookup,
  thirdPartyProtocolResult,
  thirdPartyUserResult,
  thirdPartyLocationResult,
 } from "matrix-appservice-bridge";
import { DiscordBridgeConfig } from "./config";

import * as Discord from "discord.js";
import * as log from "npmlog";
import * as Bluebird from "bluebird";
import { Util } from "./util";
import { Provisioner } from "./provisioner";

const ICON_URL = "https://matrix.org/_matrix/media/r0/download/matrix.org/mlxoESwIsTbJrfXyAAogrNxA";
const HTTP_UNSUPPORTED = 501;
const ROOM_NAME_PARTS = 2;
const AGE_LIMIT = 900000; // 15 * 60 * 1000
const PROVISIONING_DEFAULT_POWER_LEVEL = 50;
const PROVISIONING_DEFAULT_USER_POWER_LEVEL = 0;

// Note: The schedule must not have duplicate values to avoid problems in positioning.
/* tslint:disable:no-magic-numbers */ // Disabled because it complains about the values in the array
const JOIN_ROOM_SCHEDULE = [
    0,              // Right away
    1000,           // 1 second
    30000,          // 30 seconds
    300000,         // 5 minutes
    900000,         // 15 minutes
];
/* tslint:enable:no-magic-numbers */

export class MatrixRoomHandler {

  private config: DiscordBridgeConfig;
  private bridge: Bridge;
  private discord: DiscordBot;
  private botUserId: string;
  constructor (discord: DiscordBot, config: DiscordBridgeConfig, botUserId: string, private provisioner: Provisioner) {
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
    // Join a whole bunch of users.
    let promiseChain: any = Bluebird.resolve();
    /* We delay the joins to give some implementations a chance to breathe */
    let delay = this.config.limits.roomGhostJoinDelay;
    return this.discord.GetChannelFromRoomId(roomId).then((channel: Discord.Channel) => {
      for (const member of (<Discord.TextChannel> channel).members.array()) {
        if (member.id === this.discord.GetBotId()) {
          continue;
        }
        promiseChain = promiseChain.return(Bluebird.delay(delay).then(() => {
          return this.discord.InitJoinUser(member, [roomId]);
        }));
        delay += this.config.limits.roomGhostJoinDelay;
      }
    }).catch((err) => {
      log.verbose("OnAliasQueried => %s", err);
      throw err;
    });
  }

  public OnEvent (request, context): Promise<any> {
    const event = request.getData();
    if (event.unsigned.age > AGE_LIMIT) {
      log.warn("MatrixRoomHandler", "Skipping event due to age %s > %s", event.unsigned.age, AGE_LIMIT);
      return Promise.reject("Event too old");
    }
    if (event.type === "m.room.member" && event.content.membership === "invite") {
      return this.HandleInvite(event);
    } else if (event.type === "m.room.redaction" && context.rooms.remote) {
      return this.discord.ProcessMatrixRedact(event);
    } else if (event.type === "m.room.message") {
        log.verbose("MatrixRoomHandler", "Got m.room.message event");
        if (event.content.body && event.content.body.startsWith("!discord")) {
            return this.ProcessCommand(event, context);
        } else if (context.rooms.remote) {
            const srvChanPair = context.rooms.remote.roomId.substr("_discord".length).split("_", ROOM_NAME_PARTS);
            return this.discord.ProcessMatrixMsgEvent(event, srvChanPair[0], srvChanPair[1]).catch((err) => {
                log.warn("MatrixRoomHandler", "There was an error sending a matrix event", err);
            });
        }
    } else if (event.type === "m.room.encryption" && context.rooms.remote) {
        return this.HandleEncryptionWarning(event.room_id).catch((err) => {
            return Promise.reject(`Failed to handle encrypted room, ${err}`);
        });
    } else {
      log.verbose("MatrixRoomHandler", "Got non m.room.message event");
    }
    return Promise.reject("Event not processed by bridge");
  }

  public async HandleEncryptionWarning(roomId: string): Promise<void> {
      const intent = this.bridge.getIntent();
      log.info("MatrixRoomHandler", `User has turned on encryption in ${roomId}, so leaving.`);
      /* N.B 'status' is not specced but https://github.com/matrix-org/matrix-doc/pull/828
       has been open for over a year with no resolution. */
      const sendPromise = intent.sendMessage(roomId, {
          msgtype: "m.notice",
          status: "critical",
          body: "You have turned on encryption in this room, so the service will not bridge any new messages.",
      });
      const channel = await this.discord.GetChannelFromRoomId(roomId);
      await (channel as Discord.TextChannel).send(
        "Someone on Matrix has turned on encryption in this room, so the service will not bridge any new messages",
      );
      await sendPromise;
      await intent.leave(roomId);
      await this.bridge.getRoomStore().removeEntriesByMatrixRoomId(roomId);
  }

  public HandleInvite(event: any) {
    log.info("MatrixRoomHandler", "Received invite for " + event.state_key + " in room " + event.room_id);
    if (event.state_key === this.botUserId) {
      log.info("MatrixRoomHandler", "Accepting invite for bridge bot");
      return this.joinRoom(this.bridge.getIntent(), event.room_id);
    }
  }

  public async ProcessCommand(event: any, context: any) {
      if (!this.config.bridge.enableSelfServiceBridging) {
          // We can do this here because the only commands we support are self-service bridging
          return this.bridge.getIntent().sendMessage(event.room_id, {
              msgtype: "m.notice",
              body: "The owner of this bridge does not permit self-service bridging.",
          });
      }

      // Check to make sure the user has permission to do anything in the room. We can do this here
      // because the only commands we support are self-service commands (which therefore require some
      // level of permissions)
      const plEvent = await this.bridge.getIntent().getClient().getStateEvent(event.room_id, "m.room.power_levels", "");
      let userLevel = PROVISIONING_DEFAULT_USER_POWER_LEVEL;
      let requiredLevel = PROVISIONING_DEFAULT_POWER_LEVEL;
      if (plEvent && plEvent.state_default) {
          requiredLevel = plEvent.state_default;
      }
      if (plEvent && plEvent.users_default) {
          userLevel = plEvent.users_default;
      }
      if (plEvent && plEvent.users && plEvent.users[event.sender]) {
          userLevel = plEvent.users[event.sender];
      }

      if (userLevel < requiredLevel) {
          return this.bridge.getIntent().sendMessage(event.room_id, {
              msgtype: "m.notice",
              body: "You do not have the required power level in this room to create a bridge to a Discord channel.",
          });
      }

      const prefix = "!discord ";
      let command = "help";
      let args = [];
      if (event.content.body.length >= prefix.length) {
          const allArgs = event.content.body.substring(prefix.length).split(" ");
          if (allArgs.length && allArgs[0] !== "") {
              command = allArgs[0];
              allArgs.splice(0, 1);
              args = allArgs;
          }
      }

      if (command === "help" && args[0] === "bridge") {
          const link = Util.GetBotLink(this.config);
          return this.bridge.getIntent().sendMessage(event.room_id, {
              msgtype: "m.notice",
              body: "How to bridge a Discord guild:\n" +
              "1. Invite the bot to your Discord guild using this link: " + link + "\n" +
              "2. Invite me to the matrix room you'd like to bridge\n" +
              "3. Open the Discord channel you'd like to bridge in a web browser\n" +
              "4. In the matrix room, send the message `!discord bridge <guild id> <channel id>` " +
              "(without the backticks)\n" +
              "   Note: The Guild ID and Channel ID can be retrieved from the URL in your web browser.\n" +
              "   The URL is formatted as https://discordapp.com/channels/GUILD_ID/CHANNEL_ID\n" +
              "5. Enjoy your new bridge!",
          });
      } else if (command === "bridge") {
          if (context.rooms.remote) {
              return this.bridge.getIntent().sendMessage(event.room_id, {
                  msgtype: "m.notice",
                  body: "This room is already bridged to a Discord guild.",
              });
          }

          const minArgs = 2;
          if (args.length < minArgs) {
              return this.bridge.getIntent().sendMessage(event.room_id, {
                  msgtype: "m.notice",
                  body: "Invalid syntax. For more information try !discord help bridge",
              });
          }

          const guildId = args[0];
          const channelId = args[1];
          try {
              const discordResult = await this.discord.LookupRoom(guildId, channelId);
              const channel = <Discord.TextChannel> discordResult.channel;

              log.info("MatrixRoomHandler", `Bridging matrix room ${event.room_id} to ${guildId}/${channelId}`);
              this.bridge.getIntent().sendMessage(event.room_id, {
                  msgtype: "m.notice",
                  body: "I'm asking permission from the guild administrators to make this bridge.",
              });

              await this.provisioner.AskBridgePermission(channel, event.sender);
              this.provisioner.BridgeMatrixRoom(channel, event.room_id);
              return this.bridge.getIntent().sendMessage(event.room_id, {
                  msgtype: "m.notice",
                  body: "I have bridged this room to your channel",
              });
          } catch (err) {
              if (err.message === "Timed out waiting for a response from the Discord owners"
                  || err.message === "The bridge has been declined by the Discord guild") {
                  return this.bridge.getIntent().sendMessage(event.room_id, {
                      msgtype: "m.notice",
                      body: err.message,
                  });
              }

              log.error("MatrixRoomHandler", `Error bridging ${event.room_id} to ${guildId}/${channelId}`);
              log.error("MatrixRoomHandler", err);
              return this.bridge.getIntent().sendMessage(event.room_id, {
                  msgtype: "m.notice",
                  body: "There was a problem bridging that channel - has the guild owner approved the bridge?",
              });
          }
      } else if (command === "unbridge") {
          const remoteRoom = context.rooms.remote;

          if (!remoteRoom) {
              return this.bridge.getIntent().sendMessage(event.room_id, {
                  msgtype: "m.notice",
                  body: "This room is not bridged.",
              });
          }

          if (!remoteRoom.data.plumbed) {
              return this.bridge.getIntent().sendMessage(event.room_id, {
                  msgtype: "m.notice",
                  body: "This room cannot be unbridged.",
              });
          }

          try {
              await this.provisioner.UnbridgeRoom(remoteRoom);
              return this.bridge.getIntent().sendMessage(event.room_id, {
                  msgtype: "m.notice",
                  body: "This room has been unbridged",
              });
          } catch (err) {
              log.error("MatrixRoomHandler", "Error while unbridging room " + event.room_id);
              log.error("MatrixRoomHandler", err);
              return this.bridge.getIntent().sendMessage(event.room_id, {
                  msgtype: "m.notice",
                  body: "There was an error unbridging this room. " +
                    "Please try again later or contact the bridge operator.",
              });
          }
      } else if (command === "help") {
          // Unknown command or no command given to get help on, so we'll just give them the help
          return this.bridge.getIntent().sendMessage(event.room_id, {
              msgtype: "m.notice",
              body: "Available commands:\n" +
              "!discord bridge <guild id> <channel id>   - Bridges this room to a Discord channel\n" +
              "!discord unbridge                         - Unbridges a Discord channel from this room\n" +
              "!discord help <command>                   - Help menu for another command. Eg: !discord help bridge\n",
          });
      }
  }

  public OnAliasQuery (alias: string, aliasLocalpart: string): Promise<any> {
    log.info("MatrixRoomHandler", "Got request for #", aliasLocalpart);
    const srvChanPair = aliasLocalpart.substr("_discord_".length).split("_", ROOM_NAME_PARTS);
    if (srvChanPair.length < ROOM_NAME_PARTS || srvChanPair[0] === "" || srvChanPair[1] === "") {
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
    return Promise.reject({err: "Unsupported", code: HTTP_UNSUPPORTED});
  }

  public tpGetUser(protocol: string, fields: any): Promise<thirdPartyUserResult[]> {
    log.info("MatrixRoomHandler", "Got user request ", protocol, fields);
    return Promise.reject({err: "Unsupported", code: HTTP_UNSUPPORTED});
  }

  public tpParseUser(userid: string): Promise<thirdPartyUserResult[]> {
    return Promise.reject({err: "Unsupported", code: HTTP_UNSUPPORTED});
  }

  private joinRoom(intent: any, roomIdOrAlias: string): Promise<string> {
      let currentSchedule = JOIN_ROOM_SCHEDULE[0];
      const doJoin = () => Util.DelayedPromise(currentSchedule).then(() => intent.getClient().joinRoom(roomIdOrAlias));
      const errorHandler = (err) => {
          log.error("MatrixRoomHandler", `Error joining room ${roomIdOrAlias} as ${intent.getClient().getUserId()}`);
          log.error("MatrixRoomHandler", err);
          const idx = JOIN_ROOM_SCHEDULE.indexOf(currentSchedule);
          if (idx === JOIN_ROOM_SCHEDULE.length - 1) {
              log.warn("MatrixRoomHandler", `Cannot join ${roomIdOrAlias} as ${intent.getClient().getUserId()}`);
              return Promise.reject(err);
          } else {
              currentSchedule = JOIN_ROOM_SCHEDULE[idx + 1];
              return doJoin().catch(errorHandler);
          }
      };

      return doJoin().catch(errorHandler);
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
      name: `[Discord] ${channel.guild.name} #${channel.name}`,
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
