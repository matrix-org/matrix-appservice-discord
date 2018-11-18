import * as Discord from "discord.js";
import * as markdown from "discord-markdown";
import { DiscordBot } from "./bot";
import * as escapeHtml from "escape-html";
import { Util } from "./util";

import { Log } from "./log";
const log = new Log("MessageProcessor");

const MATRIX_TO_LINK = "https://matrix.to/#/";
const MXC_INSERT_REGEX = /\x01(\w+)\x01([01])\x01([0-9]*)\x01/g;
const NAME_MXC_INSERT_REGEX_GROUP = 1;
const ANIMATED_MXC_INSERT_REGEX_GROUP = 2;
const ID_MXC_INSERT_REGEX_GROUP = 3;
const EMOJI_SIZE = 32;

export class MessageProcessorOpts {
    constructor(readonly domain: string, readonly bot?: DiscordBot) {

    }
}

export class MessageProcessorMatrixResult {
    public formattedBody: string;
    public body: string;
    public msgtype: string;
}

interface IDiscordNode {
    id: string;
}

interface IEmojiNode extends IDiscordNode {
    animated: boolean;
    name: string;
}

export class MessageProcessor {
    private readonly opts: MessageProcessorOpts;
    constructor(opts: MessageProcessorOpts, bot: DiscordBot | null = null) {
        // Backwards compat
        if (bot !== null) {
            this.opts = new MessageProcessorOpts(opts.domain, bot);
        } else {
            this.opts = opts;
        }
    }

    public async FormatDiscordMessage(msg: Discord.Message): Promise<MessageProcessorMatrixResult> {
        const result = new MessageProcessorMatrixResult();

        let content = msg.content;

        // for the formatted body we need to parse markdown first
        // as else it'll HTML escape the result of the discord syntax
        let contentPostmark = markdown.toHTML(content, {
            discordCallback: this.getDiscordParseCallbacksHTML(msg),
        });

        // parse the plain text stuff
        content = markdown.toHTML(content, {
            discordCallback: this.getDiscordParseCallbacks(msg),
            discordOnly: true,
            escapeHTML: false,
        });
        content = this.InsertEmbeds(content, msg);
        content = await this.InsertMxcImages(content, msg);

        // parse postmark stuff
        contentPostmark = this.InsertEmbedsPostmark(contentPostmark, msg);
        contentPostmark = await this.InsertMxcImages(contentPostmark, msg, true);

        result.body = content;
        result.formattedBody = contentPostmark;
        result.msgtype = msg.author.bot ? "m.notice" : "m.text";
        return result;
    }

    public async FormatEdit(oldMsg: Discord.Message, newMsg: Discord.Message): Promise<MessageProcessorMatrixResult> {
        // TODO: Produce a nice, colored diff between the old and new message content
        oldMsg.content = `*edit:* ~~${oldMsg.content}~~ -> ${newMsg.content}`;
        return this.FormatDiscordMessage(oldMsg);
    }

    public InsertEmbeds(content: string, msg: Discord.Message): string {
        for (const embed of msg.embeds) {
            if (embed.title === undefined && embed.description === undefined) {
                continue;
            }
            if (this.isEmbedInBody(msg, embed)) {
                continue;
            }
            let embedContent = "\n\n----"; // Horizontal rule. Two to make sure the content doesn't become a title.
            const embedTitle = embed.url ? `[${embed.title}](${embed.url})` : embed.title;
            if (embedTitle) {
                embedContent += "\n##### " + embedTitle; // h5 is probably best.
            }
            if (embed.description) {
                embedContent += "\n" + markdown.toHTML(embed.description, {
                    discordCallback: this.getDiscordParseCallbacks(msg),
                    discordOnly: true,
                    escapeHTML: false,
                });;
            }
            content += embedContent;
        }
        return content;
    }

    public InsertEmbedsPostmark(content: string, msg: Discord.Message): string {
        for (const embed of msg.embeds) {
            if (embed.title === undefined && embed.description === undefined) {
                continue;
            }
            if (this.isEmbedInBody(msg, embed)) {
                continue;
            }
            let embedContent = "<hr>"; // Horizontal rule. Two to make sure the content doesn't become a title.
            const embedTitle = embed.url ?
                `<a href="${escapeHtml(embed.url)}">${escapeHtml(embed.title)}</a>`
                : escapeHtml(embed.title);
            if (embedTitle) {
                embedContent += `<h5>${embedTitle}</h5>`; // h5 is probably best.
            }
            if (embed.description) {
                embedContent += markdown.toHTML(embed.description, {
                    discordCallback: this.getDiscordParseCallbacksHTML(msg),
                    embed: true,
                });
            }
            content += embedContent;
        }
        return content;
    }

    public InsertUser(node: IDiscordNode, msg: Discord.Message, html: boolean = false): string {
        const id = node.id;
        const member = msg.guild.members.get(id);
        const memberId = `@_discord_${id}:${this.opts.domain}`;
        const memberName = member ? member.displayName : memberId;
        if (!html) {
            return memberName;
        }
        return `<a href="${MATRIX_TO_LINK}${escapeHtml(memberId)}">${escapeHtml(memberName)}</a>`;
    }

    public InsertChannel(node: IDiscordNode, msg: Discord.Message, html: boolean = false): string {
        const id = node.id;
        const channel = msg.guild.channels.get(id);
        const channelStr = escapeHtml(channel ? "#" + channel.name : "#" + id);
        if (!html) {
            return channelStr;
        }
        const roomId = escapeHtml(`#_discord_${msg.guild.id}_${id}:${this.opts.domain}`);
        return `<a href="${MATRIX_TO_LINK}${roomId}">${escapeHtml(channelStr)}</a>`;
    }

    public InsertRole(node: IDiscordNode, msg: Discord.Message, html: boolean = false): string {
        const id = node.id;
        const role = msg.guild.roles.get(id);
        if (!role) {
            return html ? `&lt;@&amp;${id}&gt;` : `<@&${id}>`;
        }
        if (!html) {
            return `@${role.name}`;
        }
        const color = Util.NumberToHTMLColor(role.color);
        return `<span data-mx-color="${color}"><strong>@${escapeHtml(role.name)}</strong></span>`;
    }

    public InsertEmoji(node: IEmojiNode): string {
        // unfortunately these callbacks are sync, so we flag our url with some special stuff
        // and later on grab the real url async
        const FLAG = "\x01";
        const name = escapeHtml(node.name);
        return `${FLAG}${name}${FLAG}${node.animated ? 1 : 0}${FLAG}${node.id}${FLAG}`;
    }

    public InsertRoom(): string {
        return "@room";
    }

    public async InsertMxcImages(content: string, msg: Discord.Message, html: boolean = false): Promise<string> {
        let results = MXC_INSERT_REGEX.exec(content);
        while (results !== null) {
            const name = results[NAME_MXC_INSERT_REGEX_GROUP];
            const animated = results[ANIMATED_MXC_INSERT_REGEX_GROUP] === "1";
            const id = results[ID_MXC_INSERT_REGEX_GROUP];
            let replace = "";
            try {
                const mxcUrl = await this.opts.bot!.GetEmoji(name, animated, id);
                if (html) {
                    replace = `<img alt="${name}" title="${name}" height="${EMOJI_SIZE}" src="${mxcUrl}" />`;
                } else {
                    replace = `:${name}:`;
                }
            } catch (ex) {
                log.warn(
                    `Could not insert emoji ${id} for msg ${msg.id} in guild ${msg.guild.id}: ${ex}`,
                );
                if (html) {
                    replace = `&lt;${animated ? "a" : ""}:${name}:${id}&gt;`;
                } else {
                    replace = `<${animated ? "a" : ""}:${name}:${id}>`;
                }
            }
            content = content.replace(results[0],
                replace);
            results = MXC_INSERT_REGEX.exec(content);
        }
        return content;
    }

    private isEmbedInBody(msg: Discord.Message, embed: Discord.MessageEmbed): boolean {
        if (!embed.url) {
            return false;
        }
        return msg.content.includes(embed.url);
    }

    private getDiscordParseCallbacks(msg: Discord.Message) {
        return {
            channel: (node) => this.InsertChannel(node, msg),
            emoji: (node) => this.InsertEmoji(node),
            everyone: (_) => this.InsertRoom(),
            here: (_) => this.InsertRoom(),
            role: (node) => this.InsertRole(node, msg),
            user: (node) => this.InsertUser(node, msg),
        };
    }

    private getDiscordParseCallbacksHTML(msg: Discord.Message) {
        return {
            channel: (node) => this.InsertChannel(node, msg, true),
            emoji: (node) => this.InsertEmoji(node), // are post-inserted
            everyone: (_) => this.InsertRoom(),
            here: (_) => this.InsertRoom(),
            role: (node) => this.InsertRole(node, msg, true),
            user: (node) => this.InsertUser(node, msg, true),
        };
    }
}
