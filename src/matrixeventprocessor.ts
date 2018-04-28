import * as Discord from "discord.js";
import {MessageProcessorOpts, MessageProcessor} from "./messageprocessor";
import {DiscordBot} from "./bot";
import {DiscordBridgeConfig} from "./config";

export class MatrixEventProcessorOpts {
    constructor(
        readonly config: DiscordBridgeConfig,
        readonly bridge: any,
        readonly msgProcessor: MessageProcessor) {

    }
}

export class MatrixEventProcessor {
    private config: DiscordBridgeConfig;
    private bridge: any;
    private msgProcessor: MessageProcessor;

    constructor (opts: MatrixEventProcessorOpts) {
        this.config = opts.config;
        this.msgProcessor = opts.msgProcessor;
        this.bridge = opts.bridge;
    }

    public EventToEmbed(event: any, profile: any, channel: Discord.TextChannel): Discord.RichEmbed {
        const body = this.config.bridge.disableDiscordMentions ? event.content.body :
            this.msgProcessor.FindMentionsInPlainBody(
                event.content.body,
                channel.members.array(),
            );
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
            description: body,
        });
    }
}
