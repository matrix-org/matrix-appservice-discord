import * as Discord from "discord.js";
import * as marked from "marked";
import * as log from "npmlog";
import { DiscordBot } from "./bot";
import * as escapeStringRegexp from "escape-string-regexp";

const USER_REGEX = /<@!?([0-9]*)>/g;
const USER_REGEX_POSTMARK = /&lt;@!?([0-9]*)&gt;/g;
const CHANNEL_REGEX = /<#?([0-9]*)>/g;
const CHANNEL_REGEX_POSTMARK = /&lt;#?([0-9]*)&gt;/g;
const EMOJI_SIZE = "1em";
const EMOJI_REGEX = /<:\w+:?([0-9]*)>/g;
const EMOJI_REGEX_POSTMARK = /&lt;:\w+:?([0-9]*)&gt;/g;
const MATRIX_TO_LINK = "https://matrix.to/#/";

marked.setOptions({
    sanitize: true,
});

export class MessageProcessorOpts {
    public domain: string;
    constructor (domain: string) {
        this.domain = domain;
    }

}

export class MessageProcessorMatrixResult {
    public formattedBody: string;
    public body: string;
}

export class MessageProcessor {
    private readonly opts: MessageProcessorOpts;
    private readonly bot: DiscordBot;
    constructor (opts: MessageProcessorOpts, bot: DiscordBot) {
        this.opts = opts;
        this.bot = bot;
    }

    public async FormatDiscordMessage(msg: Discord.Message): Promise<MessageProcessorMatrixResult> {
        const result = new MessageProcessorMatrixResult();
        // first do the plain-text body
        result.body = await this.InsertDiscordSyntax(msg.content, msg, false);

        // for the formatted body we need to parse markdown first as else it'll HTML escape the result of the discord syntax
        let content = msg.content;
        content = marked(content);
        content = await this.InsertDiscordSyntax(content, msg, true);
        result.formattedBody = content;
        return result;
    }

    public async InsertDiscordSyntax(content: string, msg: Discord.Message, postmark: boolean): Promise<string> {
        // Replace embeds.
        content = this.InsertEmbeds(content, msg);

        // Replace Users
        content = this.ReplaceMembers(content, msg, postmark);
        content = this.ReplaceChannels(content, msg, postmark);
        content = await this.ReplaceEmoji(content, msg, postmark);
        return content;
    }

    public InsertEmbeds(content: string, msg: Discord.Message): string {
        for (const embed of msg.embeds) {
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

    public ReplaceMembers(content: string, msg: Discord.Message, postmark: boolean = false): string {
        const reg = postmark ? USER_REGEX_POSTMARK : USER_REGEX;
        let results = reg.exec(content);
        while (results !== null) {
            const id = results[1];
            const member = msg.guild.members.get(id);
            const memberId = `@_discord_${id}:${this.opts.domain}`;
            const memberStr = member ? member.user.username : memberId;
            content = content.replace(results[0], memberStr);
            results = reg.exec(content);
        }
        return content;
    }

    public ReplaceChannels(content: string, msg: Discord.Message, postmark: boolean = false): string {
        const reg = postmark ? CHANNEL_REGEX_POSTMARK : CHANNEL_REGEX;
        let results = reg.exec(content);
        while (results !== null) {
            const id = results[1];
            const channel = msg.guild.channels.get(id);
            const roomId = `#_discord_${msg.guild.id}_${id}:${this.opts.domain}`;
            const channelStr = channel ? "#" + channel.name : "#" + id;
            content = content.replace(results[0], `[${channelStr}](${MATRIX_TO_LINK}${roomId})`);
            results = reg.exec(content);
        }
        return content;
    }

    public async ReplaceEmoji(content: string, msg: Discord.Message, postmark: boolean = false): Promise<string> {
        const reg = postmark ? EMOJI_REGEX_POSTMARK : EMOJI_REGEX;
        let results = reg.exec(content);
        while (results !== null) {
            const id = results[1];
            try {
                const mxcUrl = await this.bot.GetGuildEmoji(msg.guild, id);
                content = content.replace(results[0],
                    `<img alt="${id}" src="${mxcUrl}" style="height: ${EMOJI_SIZE};"/>`);
            } catch (ex) {
                log.warn("MessageProcessor",
                    `Could not insert emoji ${id} for msg ${msg.id} in guild ${msg.guild.id}: ${ex}`,
                );
            }
            results = reg.exec(content);
        }
        return content;
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
