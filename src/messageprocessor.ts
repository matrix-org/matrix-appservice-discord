import * as Discord from "discord.js";
import * as markdown from "discord-markdown";
import { DiscordBot } from "./bot";
import * as escapeHtml from "escape-html";
import { Util } from "./util";

import { Log } from "./log";
const log = new Log("MessageProcessor");

const USER_REGEX = /<@!?([0-9]*)>/g;
const USER_REGEX_POSTMARK = /&lt;@!?([0-9]*)&gt;/g;
const CHANNEL_REGEX = /<#?([0-9]*)>/g;
const CHANNEL_REGEX_POSTMARK = /&lt;#?([0-9]*)&gt;/g;
const EMOJI_SIZE = 32;
const EMOJI_REGEX = /<(a?):(\w+):([0-9]*)>/g;
const EMOJI_REGEX_POSTMARK = /&lt;(a?):(\w+):([0-9]*)&gt;/g;
const MATRIX_TO_LINK = "https://matrix.to/#/";

const MXC_INSERT_REGEX = /\x01(\w+)\x01([01])\x01([0-9]*)\x01/g;
const NAME_MXC_INSERT_REGEX_GROUP = 1;
const ANIMATED_MXC_INSERT_REGEX_GROUP = 2;
const ID_MXC_INSERT_REGEX_GROUP = 3;

export class MessageProcessorOpts {
    constructor(readonly domain: string, readonly bot?: DiscordBot) {

    }
}

export class MessageProcessorMatrixResult {
    public formattedBody: string;
    public body: string;
    public msgtype: string;
}

interface IUserNode {
    id: number;
}

interface IChannelNode {
    id: number;
}

interface IRoleNode {
    id: number;
}

interface IEmojiNode {
    animated: boolean;
    id: number;
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
            discordCallback: this.getDiscordCallbackHTML(msg),
        });

        // parse the plain text stuff
        content = markdown.toHTML(content, {
            discordCallback: this.getDiscordCallback(msg),
            discordOnly: true,
        });
        content = this.InsertEmbeds(content, msg);
        content = await this.InsertMxcImages(content, msg);

        // parse postmark stuff
        contentPostmark = this.InsertEmbedsPostmark(contentPostmark, msg);
        contentPostmark = await this.InsertMxcImagesHTML(contentPostmark, msg);

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
            let embedContent = "\n\n----"; // Horizontal rule. Two to make sure the content doesn't become a title.
            const embedTitle = embed.url ? `[${embed.title}](${embed.url})` : embed.title;
            if (embedTitle) {
                embedContent += "\n##### " + embedTitle; // h5 is probably best.
            }
            if (embed.description) {
                embedContent += "\n" + embed.description;
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
            let embedContent = "<hr>"; // Horizontal rule. Two to make sure the content doesn't become a title.
            const embedTitle = embed.url ?
                `<a href="${escapeHtml(embed.url)}">${escapeHtml(embed.title)}</a>`
                : escapeHtml(embed.title);
            if (embedTitle) {
                embedContent += `<h5>${embedTitle}</h5>`; // h5 is probably best.
            }
            if (embed.description) {
                embedContent += markdown.toHTML(embed.description, {
                    discordCallback: this.getDiscordCallbackHTML(msg),
                    embed: true,
                });
            }
            content += embedContent;
        }
        return content;
    }

    public InsertUser(node: IUserNode, msg: Discord.Message): string {
        const id = node.id;
        const member = msg.guild.members.get(id.toString());
        const memberId = `@_discord_${id}:${this.opts.domain}`;
        return member ? (member.displayName) : memberId;
    }

    public InsertUserHTML(node: IUserNode, msg: Discord.Message): string {
        const id = node.id;
        const member = msg.guild.members.get(id.toString());
        const memberId = escapeHtml(`@_discord_${id}:${this.opts.domain}`);
        let memberName = memberId;
        if (member) {
            memberName = escapeHtml(member.displayName);
        }
        return `<a href="${MATRIX_TO_LINK}${memberId}">${memberName}</a>`;
    }

    public InsertChannel(node: IChannelNode, msg: Discord.Message): string {
        const id = node.id;
        const channel = msg.guild.channels.get(id.toString());
        return channel ? "#" + channel.name : "#" + id;
    }

    public InsertChannelHTML(node: IChannelNode, msg: Discord.Message) {
        const id = node.id;
        const channel = msg.guild.channels.get(id.toString());
        const roomId = escapeHtml(`#_discord_${msg.guild.id}_${id}:${this.opts.domain}`);
        const channelStr = escapeHtml(channel ? "#" + channel.name : "#" + id);
        return `<a href="${MATRIX_TO_LINK}${roomId}">${channelStr}</a>`;
    }

    public InsertRole(node: IRoleNode, msg: Discord.Message): string {
        const id = node.id;
        const role = msg.guild.roles.get(id.toString());
        if (!role) {
            return `<@&${id}>`;
        }
        return `@${role.name}`;
    }

    public InsertRoleHTML(node: IRoleNode, msg: Discord.Message): string {
        const id = node.id;
        const role = msg.guild.roles.get(id.toString());
        if (!role) {
            return `&lt;@&amp;${id}&gt;`;
        }
        const color = Util.NumberToHTMLColor(role.color);
        return `<span data-mx-color="${color}"><b>@${escapeHtml(role.name)}</b></span>`;
    }

    public InsertEmoji(node: IEmojiNode): string {
        // unfortunately these callbacks are sync, so we flag our url with some special stuff
        // and later on grab the real url async
        const FLAG = "\x01";
        const name = escapeHtml(node.name);
        return `${FLAG}${name}${FLAG}${node.animated ? 1 : 0}${FLAG}${node.id}${FLAG}`;
    }

    public async InsertMxcImages(content: string, msg: Discord.Message): Promise<string> {
        let results = MXC_INSERT_REGEX.exec(content);
        while (results !== null) {
            const name = results[NAME_MXC_INSERT_REGEX_GROUP];
            const animated = results[ANIMATED_MXC_INSERT_REGEX_GROUP] === "1";
            const id = results[ID_MXC_INSERT_REGEX_GROUP];
            let replace = "";
            try {
                const mxcUrl = await this.opts.bot!.GetEmoji(name, animated, id);
                replace = `:${name}:`;
            } catch (ex) {
                log.warn(
                    `Could not insert emoji ${id} for msg ${msg.id} in guild ${msg.guild.id}: ${ex}`,
                );
                replace = `<${animated ? "a" : ""}:${name}:${id}>`;
            }
            content = content.replace(results[0],
                replace);
            results = MXC_INSERT_REGEX.exec(content);
        }
        return content;
    }

    public async InsertMxcImagesHTML(content: string, msg: Discord.Message): Promise<string> {
        let results = MXC_INSERT_REGEX.exec(content);
        while (results !== null) {
            const name = results[NAME_MXC_INSERT_REGEX_GROUP];
            const animated = results[ANIMATED_MXC_INSERT_REGEX_GROUP] === "1";
            const id = results[ID_MXC_INSERT_REGEX_GROUP];
            let replace = "";
            try {
                const mxcUrl = await this.opts.bot!.GetEmoji(name, animated, id);
                replace = `<img alt="${name}" title="${name}" height="${EMOJI_SIZE}" src="${mxcUrl}" />`;
            } catch (ex) {
                log.warn(
                    `Could not insert emoji ${id} for msg ${msg.id} in guild ${msg.guild.id}: ${ex}`,
                );
                replace = `&lt;${animated ? "a" : ""}:${name}:${id}&gt;`;
            }
            content = content.replace(results[0],
                replace);
            results = MXC_INSERT_REGEX.exec(content);
        }
        return content;
    }

    private getDiscordCallback(msg: Discord.Message) {
        return {
            channel: (node) => this.InsertChannel(node, msg),
            emoji: (node) => this.InsertEmoji(node),
            role: (node) => this.InsertRole(node, msg),
            user: (node) => this.InsertUser(node, msg),
        };
    }

    private getDiscordCallbackHTML(msg: Discord.Message) {
        return {
            channel: (node) => this.InsertChannelHTML(node, msg),
            emoji: (node) => this.InsertEmoji(node), // are post-inserted
            role: (node) => this.InsertRoleHTML(node, msg),
            user: (node) => this.InsertUserHTML(node, msg),
        };
    }
}
