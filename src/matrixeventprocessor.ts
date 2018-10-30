import * as Discord from "discord.js";
import { MessageProcessorOpts, MessageProcessor } from "./messageprocessor";
import { DiscordBot } from "./bot";
import { DiscordBridgeConfig } from "./config";
import * as escapeStringRegexp from "escape-string-regexp";
import { Util, IMatrixEvent, IMatrixEventContent } from "./util";
import * as path from "path";
import * as mime from "mime";
import { MatrixUser, Bridge } from "matrix-appservice-bridge";
import { Client as MatrixClient } from "matrix-js-sdk";

import { Log } from "./log";
const log = new Log("MatrixEventProcessor");

const MaxFileSize = 8000000;
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 32;
const DISCORD_EMOJI_REGEX = /:(\w+):/g;
const DISCORD_AVATAR_WIDTH = 128;
const DISCORD_AVATAR_HEIGHT = 128;

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

    constructor(opts: MatrixEventProcessorOpts) {
        this.config = opts.config;
        this.bridge = opts.bridge;
        this.discord = opts.discord;
    }

    public StateEventToMessage(event: IMatrixEvent, channel: Discord.TextChannel): string | undefined {
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
        return msg;
    }

    public async EventToEmbed(
        event: IMatrixEvent, profile: IMatrixEvent|null, channel: Discord.TextChannel,
    ): Promise<IMatrixEventProcessorResult> {
        let body: string = this.config.bridge.disableDiscordMentions ? event.content!.body as string :
            this.FindMentionsInPlainBody(
                event.content!.body as string,
                channel.members.array(),
            );

        if (event.type === "m.sticker") {
            body = "";
        }

        // Replace @everyone
        if (this.config.bridge.disableEveryoneMention) {
            body = body.replace(new RegExp(`@everyone`, "g"), "@ everyone");
        }

        // Replace @here
        if (this.config.bridge.disableHereMention) {
            body = body.replace(new RegExp(`@here`, "g"), "@ here");
        }

        /* See issue #82
        const isMarkdown = (event.content.format === "org.matrix.custom.html");
        if (!isMarkdown) {
          body = "\\" + body;
        }*/

        // Replace /me with * username ...
        if (event.content!.msgtype === "m.emote") {
            if (profile &&
                profile.displayname &&
                profile.displayname.length >= MIN_NAME_LENGTH &&
                profile.displayname.length <= MAX_NAME_LENGTH) {
                body = `*${profile.displayname} ${body}*`;
            } else {
                body = `*${body}*`;
            }
        }

        // replace <del>blah</del> with ~~blah~~
        body = body.replace(/<del>([^<]*)<\/del>/g, "~~$1~~");

        // Handle discord custom emoji
        body = this.ReplaceDiscordEmoji(body, channel.guild);

        const messageEmbed = new Discord.RichEmbed();
        const replyEmbedAndBody = await this.GetEmbedForReply(event);
        messageEmbed.setDescription(replyEmbedAndBody ? replyEmbedAndBody[1] : body);
        await this.SetEmbedAuthor(messageEmbed, event.sender, profile);
        return {
            messageEmbed,
            replyEmbed: replyEmbedAndBody ? replyEmbedAndBody[0] : undefined,
        };
    }

    public FindMentionsInPlainBody(body: string, members: Discord.GuildMember[]): string {
        const WORD_BOUNDARY = "(^|\:|\#|```|\\s|$|,)";
        for (const member of members) {
            const matcher = escapeStringRegexp(member.user.username + "#" + member.user.discriminator) + "|" +
                escapeStringRegexp(member.displayName);
            const regex = new RegExp(
                    `(${WORD_BOUNDARY})(@?(${matcher}))(?=${WORD_BOUNDARY})`
                    , "igmu");

            body = body.replace(regex, `$1<@!${member.id}>`);
        }
        return body;
    }

    public ReplaceDiscordEmoji(content: string, guild: Discord.Guild): string {
        let results = DISCORD_EMOJI_REGEX.exec(content);
        while (results !== null) {
            const emojiName = results[1];
            const emojiNameWithColons = results[0];

            // Check if this emoji exists in the guild
            const emoji = guild.emojis.find((e) => e.name === emojiName);
            if (emoji) {
                // Replace :a: with <:a:123ID123>
                content = content.replace(emojiNameWithColons, `<${emojiNameWithColons}${emoji.id}>`);
            }
            results = DISCORD_EMOJI_REGEX.exec(content);
        }
        return content;
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
                };
            }
        }
        return `[${name}](${url})`;
    }

    public async GetEmbedForReply(event: IMatrixEvent): Promise<[Discord.RichEmbed, string]|undefined> {
        if (!event.content) {
            event.content = {};
        }

        const relatesTo = event.content["m.relates_to"];
        let eventId = null;
        if (relatesTo && relatesTo["m.in_reply_to"]) {
            eventId = relatesTo["m.in_reply_to"].event_id;
        } else {
            return;
        }
        let reponseText = Util.GetReplyFromReplyBody(event.content.body || "");
        if (reponseText === "") {
            reponseText = "Reply with unknown content";
        }

        const intent = this.bridge.getIntent();
        const embed = new Discord.RichEmbed();
        // Try to get the event.
        try {
            const sourceEvent = await intent.getEvent(event.room_id, eventId);
            let replyText = sourceEvent.content.body  || "Reply with unknown content";
            // Check if this is also a reply.
            if (sourceEvent.content && sourceEvent.content["m.relates_to"] &&
                sourceEvent.content["m.relates_to"]["m.in_reply_to"]) {
                replyText = Util.GetReplyFromReplyBody(sourceEvent.content.body);
            }
            embed.setDescription(replyText);
            await this.SetEmbedAuthor(
                embed,
                sourceEvent.sender,
            );
        } catch (ex) {
            log.warn("Failed to handle reply, showing a unknown embed:", ex);
            // For some reason we failed to get the event, so using fallback.
            embed.setDescription("Reply with unknown content");
            embed.setAuthor("Unknown");
        }
        return [embed, reponseText];
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
            return path.basename(content.body) + "." + mime.extension(content.info.mimetype);
        }
        return "matrix-media." + mime.extension(content.info.mimetype);
    }
}
