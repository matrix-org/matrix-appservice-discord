import * as Discord from "discord.js";
import {MessageProcessorOpts, MessageProcessor} from "./messageprocessor";
import {DiscordBot} from "./bot";
import {DiscordBridgeConfig} from "./config";
import * as escapeStringRegexp from "escape-string-regexp";
import {Util} from "./util";
import * as path from "path";
import * as mime from "mime";
import * as log from "npmlog";

const MaxFileSize = 8000000;
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 32;
const DISCORD_EMOJI_REGEX = /:(\w+):/g;

export class MatrixEventProcessorOpts {
    constructor(
        readonly config: DiscordBridgeConfig,
        readonly bridge: any,
        ) {

    }
}

export class MatrixEventProcessor {
    private config: DiscordBridgeConfig;
    private bridge: any;

    constructor (opts: MatrixEventProcessorOpts) {
        this.config = opts.config;
        this.bridge = opts.bridge;
    }

    public EventToEmbed(event: any, profile: any|null, channel: Discord.TextChannel): Discord.RichEmbed {
        let body = this.config.bridge.disableDiscordMentions ? event.content.body :
            this.FindMentionsInPlainBody(
                event.content.body,
                channel.members.array(),
            );

        // Replace tab-completion mentions
        if (!this.config.bridge.disableTabCompletionMentions) {
            body = this.FindTabCompletionMention(body, channel.members.array());
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

        if (event.content.msgtype === "m.emote") {
            body = `*${body}*`;
        }

        // replace <del>blah</del> with ~~blah~~
        body = body.replace(/<del>([^<]*)<\/del>/g, "~~$1~~");

        // Handle discord custom emoji
        body = this.ReplaceDiscordEmoji(body, channel.guild);

        let displayName = event.sender;
        let avatarUrl = undefined;
        if (profile) {
            if (profile.displayname &&
                profile.displayname.length >= MIN_NAME_LENGTH &&
                profile.displayname.length <= MAX_NAME_LENGTH) {
                displayName = profile.displayname;
            }

            if (profile.avatar_url) {
                const mxClient = this.bridge.getClientFactory().getClientAs();
                avatarUrl = mxClient.mxcUrlToHttp(profile.avatar_url);
            }
        }
        return new Discord.RichEmbed({
            author: {
                name: displayName.substr(0, MAX_NAME_LENGTH),
                icon_url: avatarUrl,
                url: `https://matrix.to/#/${event.sender}`,
            },
            description: body,
        });
    }

    public FindTabCompletionMention(body: string, members: Discord.GuildMember[]): string {
        const colonIndex = body.indexOf(": ");
        if (colonIndex == -1) {
            return body;
        }

        const subjectName = body.substring(0, colonIndex);
        for (const member of members) {
            if (subjectName === member.displayName || subjectName === `${member.user.username}#${member.user.discriminator}`) {
                return `<@!${member.id}>:${body.substring(colonIndex + 1)}`;
            }
        }

        return body;
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

    public async HandleAttachment(event: any, mxClient: any): Promise<string|Discord.FileOptions> {
        const hasAttachment = [
            "m.image",
            "m.audio",
            "m.video",
            "m.file",
            "m.sticker",
        ].indexOf(event.content.msgtype) !== -1;
        if (!hasAttachment) {
            return "";
        }

        if (event.content.info == null) {
            log.info("Event was an attachment type but was missing a content.info");
            return "";
        }

        if (event.content.url == null) {
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
                    name,
                    attachment,
                };
            }
        }
        return `[${name}](${url})`;
    }

    private GetFilenameForMediaEvent(content: any): string {
        if (content.body) {
            if (path.extname(content.body) !== "") {
                return content.body;
            }
            return path.basename(content.body) + "." + mime.extension(content.info.mimetype);
        }
        return "matrix-media." + mime.extension(content.info.mimetype);
    }
}
