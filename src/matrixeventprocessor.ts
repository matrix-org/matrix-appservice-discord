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

        // Replace @everyone
        if (this.config.bridge.disableEveryoneMention) {
            body = body.replace(new RegExp(`@everyone`, "g"), "@ everyone");
        }

        // Replace @here
        if (this.config.bridge.disableHereMention) {
            body = body.replace(new RegExp(`@here`, "g"), "@ here");
        }

        if (profile) {
            profile.displayname = profile.displayname || event.sender;
            if (profile.avatar_url) {
                const mxClient = this.bridge.getClientFactory().getClientAs();
                profile.avatar_url = mxClient.mxcUrlToHttp(profile.avatar_url);
            }
            /* See issue #82
            const isMarkdown = (event.content.format === "org.matrix.custom.html");
            if (!isMarkdown) {
              body = "\\" + body;
            }
            if (event.content.msgtype === "m.emote") {
              body = `*${body}*`;
            }
            */
            return new Discord.RichEmbed({
                author: {
                    name: profile.displayname,
                    icon_url: profile.avatar_url,
                    url: `https://matrix.to/#/${event.sender}`,
                },
                description: body,
            });
        }
        return new Discord.RichEmbed({
            author: {
                name: event.sender,
                url: `https://matrix.to/#/${event.sender}`,
            },
            description: body,
        });
    }

    public FindMentionsInPlainBody(body: string, members: Discord.GuildMember[]): string {
        const WORD_BOUNDARY = "(^|\:|\@|\#|```|\\s|$|,)";
        for (const member of members) {
            const matcher = escapeStringRegexp(member.user.username + "#" + member.user.discriminator) + "|" +
                escapeStringRegexp(member.displayName);
            const regex = new RegExp(
                `(?<=${WORD_BOUNDARY})(${matcher})(?=${WORD_BOUNDARY})`
                , "igmu");
            body = body.replace(regex, `<@!${member.id}>`);
        }
        return body;
    }

    public async HandleAttachment(event: any, mxClient: any): Promise<string|Discord.FileOptions> {
        const hasAttachment = ["m.image", "m.audio", "m.video", "m.file"].indexOf(event.content.msgtype) !== -1;
        if (!hasAttachment) {
            return "";
        }
        if (event.content.info == null) {
            log.info("Event was an attachment type but was missing a content.info");
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
