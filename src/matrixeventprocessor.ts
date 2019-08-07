/*
Copyright 2018, 2019 matrix-appservice-discord

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import * as Discord from "discord.js";
import { DiscordBot } from "./bot";
import { DiscordBridgeConfig } from "./config";
import * as escapeStringRegexp from "escape-string-regexp";
import { Util, wrapError } from "./util";
import * as path from "path";
import * as mime from "mime";
import {
    Bridge,
    BridgeContext,
    MatrixUser,
    RemoteRoom,
    Request,
    unstable as Unstable,
} from "matrix-appservice-bridge";
import { Client as MatrixClient } from "matrix-js-sdk";
import { IMatrixEvent, IMatrixEventContent, IMatrixMessage } from "./matrixtypes";
import { MatrixMessageProcessor, IMatrixMessageProcessorParams } from "./matrixmessageprocessor";
import { MatrixCommandHandler } from "./matrixcommandhandler";

import { Log } from "./log";
const log = new Log("MatrixEventProcessor");

const MaxFileSize = 8000000;
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 32;
const DISCORD_AVATAR_WIDTH = 128;
const DISCORD_AVATAR_HEIGHT = 128;
const ROOM_NAME_PARTS = 2;
const AGE_LIMIT = 900000; // 15 * 60 * 1000

export class MatrixEventProcessorOpts {
    constructor(
        readonly config: DiscordBridgeConfig,
        readonly bridge: Bridge,
        readonly discord: DiscordBot,
        ) {

    }
}

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

    constructor(opts: MatrixEventProcessorOpts, cm?: MatrixCommandHandler) {
        this.config = opts.config;
        this.bridge = opts.bridge;
        this.discord = opts.discord;
        this.matrixMsgProcessor = new MatrixMessageProcessor(this.discord);
        if (cm) {
            this.mxCommandHandler = cm;
        } else {
            this.mxCommandHandler = new MatrixCommandHandler(this.discord, this.bridge, this.config);
        }
    }

    /**
     * Callback which is called when the HS notifies the bridge of a new event.
     *
     * @param request Request object containing the event for which this callback is called.
     * @param context The current context of the bridge.
     * @throws {Unstable.EventNotHandledError} When the event can finally not be handled.
     */
    public async OnEvent(request: Request, context: BridgeContext): Promise<void> {
        const event = request.getData() as IMatrixEvent;
        if (event.unsigned.age > AGE_LIMIT) {
            throw new Unstable.EventTooOldError(
                `Skipping event due to age ${event.unsigned.age} > ${AGE_LIMIT}`,
            );
        }
        if (
            event.type === "m.room.member" &&
            event.content!.membership === "invite" &&
            event.state_key === this.bridge.getClientFactory()._botUserId
        ) {
            await this.mxCommandHandler.HandleInvite(event);
            return;
        } else if (event.type === "m.room.member" && this.bridge.getBot().isRemoteUser(event.state_key)) {
            if (["leave", "ban"].includes(event.content!.membership!) && event.sender !== event.state_key) {
                // Kick/Ban handling
                let prevMembership = "";
                if (event.content!.membership === "leave") {
                    const intent = this.bridge.getIntent();
                    prevMembership = (await intent.getEvent(event.room_id, event.replaces_state)).content.membership;
                }
                await this.discord.HandleMatrixKickBan(
                    event.room_id,
                    event.state_key,
                    event.sender,
                    event.content!.membership as "leave"|"ban",
                    prevMembership,
                    event.content!.reason,
                );
            }
            return;
        } else if (["m.room.member", "m.room.name", "m.room.topic"].includes(event.type)) {
            await this.ProcessStateEvent(event);
            return;
        } else if (event.type === "m.room.redaction") {
            if (!context.rooms.remote) {
                log.info("Got radaction event with no linked room. Ignoring.");
                return;
            }
            await this.discord.ProcessMatrixRedact(event);
            return;
        } else if (event.type === "m.room.message" || event.type === "m.sticker") {
            log.verbose(`Got ${event.type} event`);
            if (isBotCommand(event)) {
                await this.mxCommandHandler.Process(event, context);
            } else {
                await this.ProcessMsgEvent(event, context);
            }
            return;
        } else if (event.type === "m.room.encryption" && context.rooms.remote) {
            try {
                await this.HandleEncryptionWarning(event.room_id);
                return;
            } catch (err) {
                throw wrapError(err, Unstable.EventNotHandledError, `Failed to handle encrypted room, ${err}`);
            }
        } else {
            throw new Unstable.EventUnknownError("Got non m.room.message event");
        }
        throw new Unstable.EventUnknownError(); // Shouldn't be reachable
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

    /**
     * Processes the message event by sending it and marking it as read.
     *
     * @param event The matrix m.room.message event to process.
     * @param context Context of the bridge.
     * @throws {Unstable.ForeignNetworkError}
     */
    public async ProcessMsgEvent(event: IMatrixEvent, context: BridgeContext): Promise<void> {
        const room = context.rooms.remote;
        if (!room) {
            log.info("Got event with no linked room. Ignoring.");
            return;
        }

        const [guildId, channelId] = guildAndChannelOf(room);
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

        // Throws an `Unstable.ForeignNetworkError` when sending the message fails.
        await this.discord.send(embedSet, opts, roomLookup, event);

        await this.sendReadReceipt(event);
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

        const isNew = event.unsigned === undefined || event.unsigned.prev_content === undefined;
        const allowJoinLeave = !this.config.bridge.disableJoinLeaveNotifications;

        if (event.type === "m.room.name") {
            msg += `set the name to \`${event.content!.name}\``;
        } else if (event.type === "m.room.topic") {
            msg += `set the topic to \`${event.content!.topic}\``;
        } else if (event.type === "m.room.member") {
            const membership = event.content!.membership;
            if (membership === "join" && isNew && allowJoinLeave) {
                msg += "joined the room";
            } else if (membership === "invite") {
                msg += `invited \`${event.state_key}\` to the room`;
            } else if (membership === "leave" && event.state_key !== event.sender) {
                msg += `kicked \`${event.state_key}\` from the room`;
            } else if (membership === "leave" && allowJoinLeave) {
                msg += "left the room";
            } else if (membership === "ban") {
                msg += `banned \`${event.state_key}\` from the room`;
            } else {
                // Ignore anything else
                return;
            }
        }

        msg += " on Matrix.";
        await this.discord.sendAsBot(msg, channel, event);
        await this.sendReadReceipt(event);
    }

    public async EventToEmbed(
        event: IMatrixEvent, channel: Discord.TextChannel, getReply: boolean = true,
    ): Promise<IMatrixEventProcessorResult> {
        const mxClient = this.bridge.getClientFactory().getClientAs();
        let profile: IMatrixEvent | null = null;
        try {
            profile = await mxClient.getStateEvent(event.room_id, "m.room.member", event.sender);
            if (!profile) {
                profile = await mxClient.getProfileInfo(event.sender);
            }
            if (!profile) {
                log.warn(`User ${event.sender} has no member state and no profile. That's odd.`);
            }
        } catch (err) {
            log.warn(`Trying to fetch member state or profile for ${event.sender} failed`, err);
        }

        const params = {
            mxClient,
            roomId: event.room_id,
            userId: event.sender,
        } as IMatrixMessageProcessorParams;
        if (profile) {
            params.displayname = profile.displayname;
        }

        let body: string = "";
        if (event.type !== "m.sticker") {
            body = await this.matrixMsgProcessor.FormatMessage(event.content as IMatrixMessage, channel.guild, params);
        }

        const messageEmbed = new Discord.RichEmbed();
        messageEmbed.setDescription(body);
        await this.SetEmbedAuthor(messageEmbed, event.sender, profile);
        const replyEmbed = getReply ? (await this.GetEmbedForReply(event, channel)) : undefined;
        if (replyEmbed && replyEmbed.fields) {
            for (let i = 0; i < replyEmbed.fields.length; i++) {
                const f = replyEmbed.fields[i];
                if (f.name === "ping") {
                    messageEmbed.description += `\n(${f.value})`;
                    replyEmbed.fields.splice(i, 1);
                    break;
                }
            }
        }
        return {
            messageEmbed,
            replyEmbed,
        };
    }

    public async HandleAttachment(event: IMatrixEvent, mxClient: MatrixClient): Promise<string|Discord.FileOptions> {
        if (!this.HasAttachment(event)) {
            return "";
        }

        if (!event.content) {
            event.content = {};
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
            const replyEmbed = (await this.EventToEmbed(sourceEvent, channel, false)).messageEmbed;

            // if we reply to a discord member, ping them!
            if (this.bridge.getBot().isRemoteUser(sourceEvent.sender)) {
                const uid = new MatrixUser(sourceEvent.sender.replace("@", "")).localpart.substring("_discord".length);
                replyEmbed.addField("ping", `<@${uid}>`);
            }

            replyEmbed.setTimestamp(new Date(sourceEvent.origin_server_ts));

            if (this.HasAttachment(sourceEvent)) {
                const mxClient = this.bridge.getClientFactory().getClientAs();
                const url = mxClient.mxcUrlToHttp(sourceEvent.content.url);
                if (["m.image", "m.sticker"].includes(sourceEvent.content.msgtype as string)
                    || sourceEvent.type === "m.sticker") {
                    // we have an image reply
                    replyEmbed.setImage(url);
                } else {
                    const name = this.GetFilenameForMediaEvent(sourceEvent.content);
                    replyEmbed.description = `[${name}](${url})`;
                }
            }
            return replyEmbed;
        } catch (ex) {
            log.warn("Failed to handle reply, showing a unknown embed:", ex);
        }
        // For some reason we failed to get the event, so using fallback.
        const embed = new Discord.RichEmbed();
        embed.setDescription("Reply with unknown content");
        embed.setAuthor("Unknown");
        return embed;
    }

    private async sendReadReceipt(event: IMatrixEvent) {
        if (!this.config.bridge.disableReadReceipts) {
            try {
                await this.bridge.getIntent().sendReadReceipt(event.room_id, event.event_id);
            } catch (err) {
                log.error(`Failed to send read receipt for ${event}. `, err);
            }
        }
    }

    private HasAttachment(event: IMatrixEvent): boolean {
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
        return hasAttachment;
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

/**
 * Returns the guild and channel of the given remote room extracted from its ID.
 * @param remoteRoom The room from which to get the guild and channel.
 * @returns (guild, channel)-tuple.
 */
function guildAndChannelOf(remoteRoom: RemoteRoom): [string, string] {
    return remoteRoom.roomId.substr("_discord".length).split("_", ROOM_NAME_PARTS);
}

/**
 * Returns true if the given event is a bot command.
 */
function isBotCommand(event: IMatrixEvent): boolean {
    return !!(
        event.type === "m.room.message" &&
        event.content!.body &&
        event.content!.body!.startsWith("!discord")
    );
}
