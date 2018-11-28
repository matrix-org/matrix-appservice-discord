import { DiscordBot } from "./bot";
import { Log } from "./log";
import { DiscordBridgeConfig } from "./config";
import { Bridge, BridgeContext } from "matrix-appservice-bridge";
import { IMatrixEvent } from "./matrixtypes";
import { Provisioner } from "./provisioner";
import { Util } from "./util";
import * as Discord from "discord.js";
const log = new Log("MatrixCommandHandler");

/* tslint:disable:no-magic-numbers */
const PROVISIONING_DEFAULT_POWER_LEVEL = 50;
const PROVISIONING_DEFAULT_USER_POWER_LEVEL = 0;
const ROOM_CACHE_MAXAGE_MS = 15 * 60 * 1000;
/* tslint:enable:no-magic-numbers */

export class MatrixCommandHandler {
    private config: DiscordBridgeConfig;
    private bridge: Bridge;
    private discord: DiscordBot;
    private provisioner: Provisioner;
    private botUserId: string;
    private botJoinedRooms: Set<string>; // roomids
    private botJoinedRoomsCacheUpdatedAt = 0;
    constructor(discord: DiscordBot, config: DiscordBridgeConfig) {
        this.discord = discord;
        this.config = config;
        this.provisioner = this.discord.Provisioner;
        this.botJoinedRooms = new Set();
    }

    public setBridge(bridge: Bridge) {
        this.bridge = bridge;
    }

    public async HandleInvite(event: IMatrixEvent) {
        log.info(`Received invite for ${event.state_key} in room ${event.room_id}`);
        if (event.state_key === this.discord.getBotId()) {
            log.info("Accepting invite for bridge bot");
            await this.bridge.getIntent().joinRoom(event.room_id);
            this.botJoinedRooms.add(event.room_id);
        }
    }

    public async ProcessCommand(event: IMatrixEvent, context: BridgeContext) {
        const intent = this.bridge.getIntent();
        if (!(await this.isBotInRoom(event.room_id))) {
            log.warn(`Bot is not in ${event.room_id}. Ignoring command`);
            return;
        }

        if (!this.config.bridge.enableSelfServiceBridging) {
            // We can do this here because the only commands we support are self-service bridging
            return this.bridge.getIntent().sendMessage(event.room_id, {
                body: "The owner of this bridge does not permit self-service bridging.",
                msgtype: "m.notice",
            });
        }

        // Check to make sure the user has permission to do anything in the room. We can do this here
        // because the only commands we support are self-service commands (which therefore require some
        // level of permissions)
        const plEvent = await this.bridge.getIntent().getClient()
            .getStateEvent(event.room_id, "m.room.power_levels", "");
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
                body: "You do not have the required power level in this room to create a bridge to a Discord channel.",
                msgtype: "m.notice",
            });
        }

        const {command, args} = Util.MsgToArgs(event.content!.body as string, "!discord");

        if (command === "help" && args[0] === "bridge") {
            const link = Util.GetBotLink(this.config);
            // tslint:disable prefer-template
            return this.bridge.getIntent().sendMessage(event.room_id, {
                body: "How to bridge a Discord guild:\n" +
                "1. Invite the bot to your Discord guild using this link: " + link + "\n" +
                "2. Invite me to the matrix room you'd like to bridge\n" +
                "3. Open the Discord channel you'd like to bridge in a web browser\n" +
                "4. In the matrix room, send the message `!discord bridge <guild id> <channel id>` " +
                "(without the backticks)\n" +
                "   Note: The Guild ID and Channel ID can be retrieved from the URL in your web browser.\n" +
                "   The URL is formatted as https://discordapp.com/channels/GUILD_ID/CHANNEL_ID\n" +
                "5. Enjoy your new bridge!",
                msgtype: "m.notice",
            });
            // tslint:enable prefer-template
        } else if (command === "bridge") {
            if (context.rooms.remote) {
                return this.bridge.getIntent().sendMessage(event.room_id, {
                    body: "This room is already bridged to a Discord guild.",
                    msgtype: "m.notice",
                });
            }

            const MAXARGS = 2;
            if (args.length > MAXARGS || args.length < 1) {
                return this.bridge.getIntent().sendMessage(event.room_id, {
                    body: "Invalid syntax. For more information try !discord help bridge",
                    msgtype: "m.notice",
                });
            }

            let guildId: string;
            let channelId: string;

            const AMOUNT_OF_IDS_DISCORD_IDENTIFIES_ROOMS_BY = 2;

            if (args.length === AMOUNT_OF_IDS_DISCORD_IDENTIFIES_ROOMS_BY) { // "x y" syntax
                guildId = args[0];
                channelId = args[1];
            } else if (args.length === 1 && args[0].includes("/")) { // "x/y" syntax
                const split = args[0].split("/");
                guildId = split[0];
                channelId = split[1];
            } else {
                return this.bridge.getIntent().sendMessage(event.room_id, {
                    body: "Invalid syntax: See `!discord help`",
                    formatted_body: "Invalid syntax: See <code>!discord help</code>",
                    msgtype: "m.notice",
                });
            }

            try {
                const discordResult = await this.discord.LookupRoom(guildId, channelId);
                const channel = discordResult.channel as Discord.TextChannel;

                log.info(`Bridging matrix room ${event.room_id} to ${guildId}/${channelId}`);
                this.bridge.getIntent().sendMessage(event.room_id, {
                    body: "I'm asking permission from the guild administrators to make this bridge.",
                    msgtype: "m.notice",
                });

                await this.provisioner.AskBridgePermission(channel, event.sender);
                this.provisioner.BridgeMatrixRoom(channel, event.room_id);
                return this.bridge.getIntent().sendMessage(event.room_id, {
                    body: "I have bridged this room to your channel",
                    msgtype: "m.notice",
                });
            } catch (err) {
                if (err.message === "Timed out waiting for a response from the Discord owners"
                    || err.message === "The bridge has been declined by the Discord guild") {
                    return this.bridge.getIntent().sendMessage(event.room_id, {
                        body: err.message,
                        msgtype: "m.notice",
                    });
                }

                log.error(`Error bridging ${event.room_id} to ${guildId}/${channelId}`);
                log.error(err);
                return this.bridge.getIntent().sendMessage(event.room_id, {
                    body: "There was a problem bridging that channel - has the guild owner approved the bridge?",
                    msgtype: "m.notice",
                });
            }
        } else if (command === "unbridge") {
            const remoteRoom = context.rooms.remote;

            if (!remoteRoom) {
                return this.bridge.getIntent().sendMessage(event.room_id, {
                    body: "This room is not bridged.",
                    msgtype: "m.notice",
                });
            }

            if (!remoteRoom.data.plumbed) {
                return this.bridge.getIntent().sendMessage(event.room_id, {
                    body: "This room cannot be unbridged.",
                    msgtype: "m.notice",
                });
            }

            try {
                await this.provisioner.UnbridgeRoom(remoteRoom);
                return this.bridge.getIntent().sendMessage(event.room_id, {
                    body: "This room has been unbridged",
                    msgtype: "m.notice",
                });
            } catch (err) {
                log.error("Error while unbridging room " + event.room_id);
                log.error(err);
                return this.bridge.getIntent().sendMessage(event.room_id, {
                    body: "There was an error unbridging this room. " +
                      "Please try again later or contact the bridge operator.",
                    msgtype: "m.notice",
                });
            }
        } else if (command === "help") {
            // Unknown command or no command given to get help on, so we'll just give them the help
            // tslint:disable prefer-template
            return this.bridge.getIntent().sendMessage(event.room_id, {
                body: "Available commands:\n" +
                "!discord bridge <guild id> <channel id>   - Bridges this room to a Discord channel\n" +
                "!discord unbridge                         - Unbridges a Discord channel from this room\n" +
                "!discord help <command>                   - Help menu for another command. Eg: !discord help bridge\n",
                msgtype: "m.notice",
            });
            // tslint:enable prefer-template
        }
    }

    private async isBotInRoom(roomId: string): Promise<boolean> {
        // Update the room cache, if not done already.
        if (Date.now () - this.botJoinedRoomsCacheUpdatedAt > ROOM_CACHE_MAXAGE_MS) {
            log.verbose("Updating room cache for bot...");
            try {
                log.verbose("Got new room cache for bot");
                this.botJoinedRoomsCacheUpdatedAt = Date.now();
                const rooms = (await this.bridge.getBot().getJoinedRooms()) as string[];
                this.botJoinedRooms = new Set(rooms);
            } catch (e) {
                log.error("Failed to get room cache for bot, ", e);
                return false;
            }
        }
        return this.botJoinedRooms.has(roomId);
    }
}
