import * as Discord from "discord.js";
import { DiscordBot } from "./bot";
import { DiscordBridgeConfig } from "./config";
import * as escapeStringRegexp from "escape-string-regexp";
import { Util } from "./util";
import * as path from "path";
import * as mime from "mime";
import { MatrixUser, Bridge } from "matrix-appservice-bridge";
import { Client as MatrixClient } from "matrix-js-sdk";
import { IMatrixEvent, IMatrixEventContent, IMatrixMessage } from "./matrixtypes";
import { MatrixMessageProcessor, MatrixMessageProcessorOpts } from "./matrixmessageprocessor";
import { MatrixCommandHandler } from "./matrixcommandhandler";

import { Log } from "./log";
const log = new Log("MatrixEventProcessor");

const MaxFileSize = 8000000;
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 32;
const DISCORD_AVATAR_WIDTH = 128;
const DISCORD_AVATAR_HEIGHT = 128;
const AGE_LIMIT = 900000; // 15 * 60 * 1000
const USERSYNC_STATE_DELAY_MS = 5000;
const ROOM_NAME_PARTS = 2;

export interface IMatrixEventProcessorResult {
    messageEmbed: Discord.RichEmbed;
    replyEmbed?: Discord.RichEmbed;
}

export class MatrixEventProcessor {
    private config: DiscordBridgeConfig;
    private bridge: Bridge;
    private discord: DiscordBot;
    private matrixMsgProcessor: MatrixMessageProcessor;
    private mxCommandHandler: MatrixCommandHandler;

    constructor(discord: DiscordBot, config: DiscordBridgeConfig, cm?: MatrixCommandHandler) {
        this.discord = discord;
        this.config = config;
        this.matrixMsgProcessor = new MatrixMessageProcessor(
            this.discord,
            new MatrixMessageProcessorOpts(
                this.config.bridge.disableEveryoneMention,
                this.config.bridge.disableHereMention,
            ),
        );
        if (cm) {
            this.mxCommandHandler = cm;
        } else {
            this.mxCommandHandler = new MatrixCommandHandler(this.discord, this.config);
        }
    }

    public setBridge(bridge: Bridge) {
        this.bridge = bridge;
        this.mxCommandHandler.setBridge(bridge);
    }

    public async OnEvent(request, context): Promise<void> {
        const event = request.getData() as IMatrixEvent;
        if (event.unsigned.age > AGE_LIMIT) {
            log.warn(`Skipping event due to age ${event.unsigned.age} > ${AGE_LIMIT}`);
            throw new Error("Event too old");
        }
        if (
            event.type === "m.room.member"
            && event.content!.membership === "invite"
            && event.state_key === this.discord.getBotId()
        ) {
            await this.mxCommandHandler.HandleInvite(event);
            return;
        } else if (event.type === "m.room.member" && event.content!.membership === "join") {
            if (this.bridge.getBot().isRemoteUser(event.state_key)) {
                await this.discord.UserSyncroniser.OnMemberState(event, USERSYNC_STATE_DELAY_MS);
            } else {
                await this.ProcessStateEvent(event);
            }
            return;
        } else if (["m.room.member", "m.room.name", "m.room.topic"].includes(event.type)) {
            await this.ProcessStateEvent(event);
            return;
        } else if (event.type === "m.room.redaction" && context.rooms.remote) {
            await this.discord.ProcessMatrixRedact(event);
            return;
        } else if (event.type === "m.room.message" || event.type === "m.sticker") {
            log.verbose(`Got ${event.type} event`);
            const isBotCommand = event.type === "m.room.message" &&
                event.content!.body &&
                event.content!.body!.startsWith("!discord");
            if (isBotCommand) {
                await this.mxCommandHandler.ProcessCommand(event, context);
                return;
            } else if (context.rooms.remote) {
                const srvChanPair = context.rooms.remote.roomId.substr("_discord".length).split("_", ROOM_NAME_PARTS);
                try {
                    await this.ProcessMsgEvent(event, srvChanPair[0], srvChanPair[1]);
                    return;
                } catch (err) {
                    log.warn("There was an error sending a matrix event", err);
                    return;
                }
            }
        } else if (event.type === "m.room.encryption" && context.rooms.remote) {
            try {
                await this.HandleEncryptionWarning(event.room_id);
                return;
            } catch (err) {
                throw new Error(`Failed to handle encrypted room, ${err}`);
            }
        } else {
            log.verbose("Got non m.room.message event");
        }
        throw new Error("Event not processed by bridge");
    }

    public async ProcessStateEvent(event: IMatrixEvent) {
        log.verbose(`Got state event from ${event.room_id} ${event.type}`);
        const channel = await this.discord.GetChannelFromRoomId(event.room_id) as Discord.TextChannel;

        const SUPPORTED_EVENTS = ["m.room.member", "m.room.name", "m.room.topic"];
        if (!SUPPORTED_EVENTS.includes(event.type)) {
            log.verbose(`${event.event_id} ${event.type} is not displayable.`);
            return;
        }

        if (event.sender === this.bridge.getIntent().getClient().getUserId()) {
            log.verbose(`${event.event_id} ${event.type} is by our bot user, ignoring.`);
            return;
        }

        let msg = `\`${event.sender}\` `;

        if (event.type === "m.room.name") {
            msg += `set the name to \`${event.content!.name}\``;
        } else if (event.type === "m.room.topic") {
            msg += `set the topic to \`${event.content!.topic}\``;
        } else if (event.type === "m.room.member") {
            const membership = event.content!.membership;
            if (membership === "join"
                && event.unsigned.prev_content === undefined) {
                msg += `joined the room`;
            } else if (membership === "invite") {
                msg += `invited \`${event.state_key}\` to the room`;
            } else if (membership === "leave" && event.state_key !== event.sender) {
                msg += `kicked \`${event.state_key}\` from the room`;
            } else if (membership === "leave") {
                msg += `left the room`;
            } else if (membership === "ban") {
                msg += `banned \`${event.state_key}\` from the room`;
            }
        }

        msg += " on Matrix.";
        await this.discord.sendAsBot(msg, channel, event);
    }

    public async HandleEncryptionWarning(roomId: string): Promise<void> {
        const intent = this.bridge.getIntent();
        log.info(`User has turned on encryption in ${roomId}, so leaving.`);
        /* N.B 'status' is not specced but https://github.com/matrix-org/matrix-doc/pull/828
         has been open for over a year with no resolution. */
        const sendPromise = intent.sendMessage(roomId, {
            body: "You have turned on encryption in this room, so the service will not bridge any new messages.",
            msgtype: "m.notice",
            status: "critical",
        });
        const channel = await this.discord.GetChannelFromRoomId(roomId);
        await (channel as Discord.TextChannel).send(
          "Someone on Matrix has turned on encryption in this room, so the service will not bridge any new messages",
        );
        await sendPromise;
        await intent.leave(roomId);
        await this.bridge.getRoomStore().removeEntriesByMatrixRoomId(roomId);
    }

    public async ProcessMsgEvent(event: IMatrixEvent, guildId: string, channelId: string) {
        const mxClient = this.bridge.getClientFactory().getClientAs();
        log.verbose(`Looking up ${guildId}_${channelId}`);
        const roomLookup = await this.discord.LookupRoom(guildId, channelId, event.sender);
        const chan = roomLookup.channel;
        const botUser = roomLookup.botUser;

        const embedSet = await this.EventToEmbed(event, chan);
        const opts: Discord.MessageOptions = {};
        const file = await this.HandleAttachment(event, mxClient);
        if (typeof(file) === "string") {
            embedSet.messageEmbed.description += " " + file;
        } else {
            opts.file = file;
        }

        await this.discord.send(embedSet, opts, roomLookup, event);
    }

    public async EventToEmbed(
        event: IMatrixEvent, channel: Discord.TextChannel, getReply: boolean = true,
    ): Promise<IMatrixEventProcessorResult> {
        const mxClient = this.bridge.getClientFactory().getClientAs();
        const profile = await mxClient.getStateEvent(event.room_id, "m.room.member", event.sender);
        if (!profile) {
            log.warn(`User ${event.sender} has no member state. That's odd.`);
        }

        let body: string = "";
        if (event.type !== "m.sticker") {
            body = await this.matrixMsgProcessor.FormatMessage(event.content as IMatrixMessage, channel.guild, profile);
        }

        const messageEmbed = new Discord.RichEmbed();
        messageEmbed.setDescription(body);
        await this.SetEmbedAuthor(messageEmbed, event.sender, profile);
        const replyEmbed = getReply ? (await this.GetEmbedForReply(event, channel)) : undefined;
        return {
            messageEmbed,
            replyEmbed,
        };
    }

    public async HandleAttachment(event: IMatrixEvent, mxClient: MatrixClient): Promise<string|Discord.FileOptions> {
        if (!event.content) {
            event.content = {};
        }

        const hasAttachment = [
            "m.image",
            "m.audio",
            "m.video",
            "m.file",
            "m.sticker",
        ].includes(event.content.msgtype as string) || [
            "m.sticker",
        ].includes(event.type);
        if (!hasAttachment) {
            return "";
        }

        if (!event.content.info) {
            // Fractal sends images without an info, which is technically allowed
            // but super unhelpful:  https://gitlab.gnome.org/World/fractal/issues/206
            event.content.info = {size: 0};
        }

        if (!event.content.url) {
            log.info("Event was an attachment type but was missing a content.url");
            return "";
        }

        let size = event.content.info.size || 0;
        const url = mxClient.mxcUrlToHttp(event.content.url);
        const name = this.GetFilenameForMediaEvent(event.content);
        if (size < MaxFileSize) {
            const attachment = await Util.DownloadFile(url);
            size = attachment.byteLength;
            if (size < MaxFileSize) {
                return {
                    attachment,
                    name,
                } as Discord.FileOptions;
            }
        }
        return `[${name}](${url})`;
    }

    public async GetEmbedForReply(
        event: IMatrixEvent,
        channel: Discord.TextChannel,
    ): Promise<Discord.RichEmbed|undefined> {
        if (!event.content) {
            event.content = {};
        }

        const relatesTo = event.content["m.relates_to"];
        let eventId = "";
        if (relatesTo && relatesTo["m.in_reply_to"]) {
            eventId = relatesTo["m.in_reply_to"].event_id;
        } else {
            return;
        }

        const intent = this.bridge.getIntent();
        // Try to get the event.
        try {
            const sourceEvent = await intent.getEvent(event.room_id, eventId);
            sourceEvent.content.body = sourceEvent.content.body  || "Reply with unknown content";
            return (await this.EventToEmbed(sourceEvent, channel, false)).messageEmbed;
        } catch (ex) {
            log.warn("Failed to handle reply, showing a unknown embed:", ex);
        }
        // For some reason we failed to get the event, so using fallback.
        const embed = new Discord.RichEmbed();
        embed.setDescription("Reply with unknown content");
        embed.setAuthor("Unknown");
        return embed;
    }

    private async SetEmbedAuthor(embed: Discord.RichEmbed, sender: string, profile?: IMatrixEvent | null) {
        const intent = this.bridge.getIntent();
        let displayName = sender;
        let avatarUrl;

        // Are they a discord user.
        if (this.bridge.getBot().isRemoteUser(sender)) {
            const localpart = new MatrixUser(sender.replace("@", "")).localpart;
            const userOrMember = await this.discord.GetDiscordUserOrMember(localpart.substring("_discord".length));
            if (userOrMember instanceof Discord.User) {
                embed.setAuthor(
                    userOrMember.username,
                    userOrMember.avatarURL,
                );
                return;
            } else if (userOrMember instanceof Discord.GuildMember) {
                embed.setAuthor(
                    userOrMember.displayName,
                    userOrMember.user.avatarURL,
                );
                return;
            }
            // Let it fall through.
        }
        if (!profile) {
            try {
                profile = await intent.getProfileInfo(sender);
            } catch (ex) {
                log.warn(`Failed to fetch profile for ${sender}`, ex);
            }
        }

        if (profile) {
            if (profile.displayname &&
                profile.displayname.length >= MIN_NAME_LENGTH &&
                profile.displayname.length <= MAX_NAME_LENGTH) {
                displayName = profile.displayname;
            }

            if (profile.avatar_url) {
                const mxClient = this.bridge.getClientFactory().getClientAs();
                avatarUrl = mxClient.mxcUrlToHttp(profile.avatar_url, DISCORD_AVATAR_WIDTH, DISCORD_AVATAR_HEIGHT);
            }
        }
        embed.setAuthor(
            displayName.substr(0, MAX_NAME_LENGTH),
            avatarUrl,
            `https://matrix.to/#/${sender}`,
        );
    }

    private GetFilenameForMediaEvent(content: IMatrixEventContent): string {
        if (content.body) {
            if (path.extname(content.body) !== "") {
                return content.body;
            }
            return `${path.basename(content.body)}.${mime.extension(content.info.mimetype)}`;
        }
        return "matrix-media." + mime.extension(content.info.mimetype);
    }
}
