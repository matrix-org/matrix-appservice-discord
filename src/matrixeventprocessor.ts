import * as Discord from "discord.js";
import {MessageProcessorOpts, MessageProcessor} from "./messageprocessor";
import {DiscordBot} from "./bot";
import {DiscordBridgeConfig} from "./config";
import * as escapeStringRegexp from "escape-string-regexp";

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
        for (const member of members) {
            const matcher = escapeStringRegexp(member.user.username + "#" + member.user.discriminator) + "|" +
                escapeStringRegexp(member.displayName);
            body = body.replace(
                new RegExp(
                    `\\b(${matcher})(?=\\b)`
                    , "mig"), `<@!${member.id}>`,
            );
        }
        return body;
    }

}
