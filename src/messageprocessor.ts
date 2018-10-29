import * as Discord from "discord.js";
import * as marked from "marked";
import { DiscordBot } from "./bot";
import * as escapeHtml from "escape-html";

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

const ANIMATED_EMOJI_REGEX_GROUP = 1;
const NAME_EMOJI_REGEX_GROUP = 2;
const ID_EMOJI_REGEX_GROUP = 3;

function _setupMarked() {
    marked.setOptions({
        sanitize: true,
        tables: false,
    });

    const markedLexer = new marked.Lexer();
    // as discord doesn't support these markdown rules
    // we want to disable them by setting their regexes to non-matchable ones
    // deleting the regexes would lead to marked-internal errors
    for (const r of ["hr", "heading", "lheading", "blockquote", "list", "item", "bullet", "def", "table", "lheading"]) {
        markedLexer.rules[r] = /$^/;
    }
    // paragraph-end matching is different, as we don't have headers and thelike
    markedLexer.rules.paragraph = /^((?:[^\n]+\n\n)+)\n*/;

    const markedInlineLexer = new marked.InlineLexer(true);
    // same again, remove tags discord doesn't support
    for (const r of ["tag", "link", "reflink", "nolink", "br"]) {
        markedInlineLexer.rules[r] = /$^/;
    }
    // discords em for underscores supports if there are spaces around the underscores, thus change that
    markedInlineLexer.rules.em = /^_([^_](?:[^_]|__)*?[^_]?)_\b|^\*((?:\*\*|[^*])+?)\*(?!\*)/;
}

export class MessageProcessorOpts {
    constructor(readonly domain: string, readonly bot: DiscordBot) {

    }
}

export class MessageProcessorMatrixResult {
    public formattedBody: string;
    public body: string;
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
        let contentPostmark = marked(content).replace(/\n/g, "<br>").replace(/(<br>)?<\/p>(<br>)?/g, "</p>");

        // parse the plain text stuff
        content = this.InsertEmbeds(content, msg);
        content = this.ReplaceMembers(content, msg);
        content = this.ReplaceChannels(content, msg);
        content = await this.ReplaceEmoji(content, msg);

        // parse postmark stuff
        contentPostmark = this.InsertEmbedsPostmark(contentPostmark, msg);
        contentPostmark = this.ReplaceMembersPostmark(contentPostmark, msg);
        contentPostmark = this.ReplaceChannelsPostmark(contentPostmark, msg);
        contentPostmark = await this.ReplaceEmojiPostmark(contentPostmark, msg);

        result.body = content;
        result.formattedBody = contentPostmark;
        return result;
    }

    public async FormatEdit(oldMsg: Discord.Message, newMsg: Discord.Message): Promise<MessageProcessorMatrixResult> {
        // TODO: Produce a nice, colored diff between the old and new message content
        oldMsg.content = "*edit:* ~~" + oldMsg.content + "~~ -> " + newMsg.content;
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
            const embedTitle = embed.url ? "<a href=\"" +
                escapeHtml(embed.url) + "\">" + escapeHtml(embed.title) +
                "</a>" : escapeHtml(embed.title);
            if (embedTitle) {
                embedContent += "<h5>" + embedTitle + "</h5>"; // h5 is probably best.
            }
            if (embed.description) {
                embedContent += marked(embed.description).replace(/\n/g, "<br>")
                    .replace(/(<br>)?<\/p>(<br>)?/g, "</p>");
            }
            content += embedContent;
        }
        return content;
    }

    public ReplaceMembers(content: string, msg: Discord.Message): string {
        let results = USER_REGEX.exec(content);
        while (results !== null) {
            const id = results[1];
            const member = msg.guild.members.get(id);
            const memberId = `@_discord_${id}:${this.opts.domain}`;
            const memberStr = member ? (member.displayName) : memberId;
            content = content.replace(results[0], memberStr);
            results = USER_REGEX.exec(content);
        }
        return content;
    }

    public ReplaceMembersPostmark(content: string, msg: Discord.Message): string {
        let results = USER_REGEX_POSTMARK.exec(content);
        while (results !== null) {
            const id = results[1];
            const member = msg.guild.members.get(id);
            const memberId = escapeHtml(`@_discord_${id}:${this.opts.domain}`);
            let memberName = memberId;
            if (member) {
                memberName = escapeHtml(member.displayName);
            }
            const memberStr = `<a href="${MATRIX_TO_LINK}${memberId}">${memberName}</a>`;
            content = content.replace(results[0], memberStr);
            results = USER_REGEX_POSTMARK.exec(content);
        }
        return content;
    }

    public ReplaceChannels(content: string, msg: Discord.Message): string {
        let results = CHANNEL_REGEX.exec(content);
        while (results !== null) {
            const id = results[1];
            const channel = msg.guild.channels.get(id);
            const channelStr = channel ? "#" + channel.name : "#" + id;
            content = content.replace(results[0], channelStr);
            results = CHANNEL_REGEX.exec(content);
        }
        return content;
    }

    public ReplaceChannelsPostmark(content: string, msg: Discord.Message): string {
        let results = CHANNEL_REGEX_POSTMARK.exec(content);
        while (results !== null) {
            const id = results[1];
            const channel = msg.guild.channels.get(id);
            const roomId = escapeHtml(`#_discord_${msg.guild.id}_${id}:${this.opts.domain}`);
            const channelStr = escapeHtml(channel ? "#" + channel.name : "#" + id);
            const replaceStr = `<a href="${MATRIX_TO_LINK}${roomId}">${channelStr}</a>`;
            content = content.replace(results[0], replaceStr);
            results = CHANNEL_REGEX_POSTMARK.exec(content);
        }
        return content;
    }

    public async ReplaceEmoji(content: string, msg: Discord.Message): Promise<string> {
        let results = EMOJI_REGEX.exec(content);
        while (results !== null) {
            const animated = results[ANIMATED_EMOJI_REGEX_GROUP] === "a";
            const name = results[NAME_EMOJI_REGEX_GROUP];
            const id = results[ID_EMOJI_REGEX_GROUP];
            try {
                // we still fetch the mxcUrl to check if the emoji is valid=
                const mxcUrl = await this.opts.bot.GetEmoji(name, animated, id);
                content = content.replace(results[0], `:${name}:`);
            } catch (ex) {
                log.warn(
                    `Could not insert emoji ${id} for msg ${msg.id} in guild ${msg.guild.id}: ${ex}`,
                );
            }

            results = EMOJI_REGEX.exec(content);

        }
        return content;
    }

    public async ReplaceEmojiPostmark(content: string, msg: Discord.Message): Promise<string> {
        let results = EMOJI_REGEX_POSTMARK.exec(content);
        while (results !== null) {
            const animated = results[ANIMATED_EMOJI_REGEX_GROUP] === "a";
            const name = escapeHtml(results[NAME_EMOJI_REGEX_GROUP]);
            const id = results[ID_EMOJI_REGEX_GROUP];
            try {
                const mxcUrl = await this.opts.bot.GetEmoji(name, animated, id);
                content = content.replace(results[0],
                    `<img alt="${name}" title="${name}" height="${EMOJI_SIZE}" src="${mxcUrl}" />`);
            } catch (ex) {
                log.warn(
                    `Could not insert emoji ${id} for msg ${msg.id} in guild ${msg.guild.id}: ${ex}`,
                );
            }
            results = EMOJI_REGEX_POSTMARK.exec(content);
        }
        return content;
    }
}

_setupMarked();
