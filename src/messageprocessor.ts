import * as Discord from "discord.js";
import * as marked from "marked";
import * as log from "npmlog";
import { DiscordStore } from "./store";
import { DiscordBot } from "./bot";
import * as escapeStringRegexp from "escape-string-regexp";
import * as escapeHtml from "escape-html";

const USER_REGEX = /<@!?([0-9]*)>/g;
const USER_REGEX_POSTMARK = /&lt;@!?([0-9]*)&gt;/g;
const CHANNEL_REGEX = /<#?([0-9]*)>/g;
const CHANNEL_REGEX_POSTMARK = /&lt;#?([0-9]*)&gt;/g;
const EMOJI_SIZE = "1em";
const ROLES_REGEX = /<@&?([0-9]*)>/g;
const EMOJI_REGEX = /<(a?):(\w+):([0-9]*)>/g;
const EMOJI_REGEX_POSTMARK = /&lt;(a?):(\w+):([0-9]*)&gt;/g;
const MATRIX_TO_LINK = "https://matrix.to/#/";

const ANIMATED_EMOJI_REGEX_GROUP = 1;
const NAME_EMOJI_REGEX_GROUP = 2;
const ID_EMOJI_REGEX_GROUP = 3;

marked.setOptions({
    sanitize: true,
});

export class MessageProcessorOpts {
    constructor (readonly domain: string, readonly bot: DiscordBot = null) {

    }

}

export class MessageProcessorMatrixResult {
    public formattedBody: string;
    public body: string;
}

export class MessageProcessor {
    private readonly opts: MessageProcessorOpts;
    constructor (opts: MessageProcessorOpts, bot: DiscordBot = null) {
        // Backwards compat
        if (bot != null) {
            this.opts = new MessageProcessorOpts(opts.domain, bot);
        } else {
            this.opts = opts;
        }
    }

    public async FormatDiscordMessage(msg: Discord.Message): Promise<MessageProcessorMatrixResult> {
        const result = new MessageProcessorMatrixResult();

        let content = msg.content;
        // embeds are markdown formatted, thus inserted before
        // for both plaintext and markdown
        content = this.InsertEmbeds(content, msg);
        
        // for the formatted body we need to parse markdown first
        // as else it'll HTML escape the result of the discord syntax
        let contentPostmark = marked(content);
        
        // parse the plain text stuff
        content = this.ReplaceMembers(content, msg);
        content = this.ReplaceChannels(content, msg);
        content = this.ReplaceRoles(content, msg);
        content = await this.ReplaceEmoji(content, msg);
        
        // parse postmark stuff
        contentPostmark = await this.ReplaceMembersPostmark(contentPostmark, msg);
        contentPostmark = this.ReplaceChannelsPostmark(contentPostmark, msg);
        contentPostmark = await this.ReplaceEmojiPostmark(contentPostmark, msg);
        
        result.body = content;
        result.formattedBody = contentPostmark;
        return result;
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

    public ReplaceMembers(content: string, msg: Discord.Message): string {
        let results = USER_REGEX.exec(content);
        while (results !== null) {
            const id = results[1];
            const member = msg.guild.members.get(id);
            const memberId = `@_discord_${id}:${this.opts.domain}`;
            const memberStr = member ? member.user.username : memberId;
            content = content.replace(results[0], memberStr);
            results = USER_REGEX.exec(content);
        }
        return content;
    }
    public async ReplaceMembersPostmark(content: string, msg: Discord.Message): Promise<string> {
        let results = USER_REGEX_POSTMARK.exec(content);
        while (results !== null) {
            const id = results[1];
            const member = msg.guild.members.get(id);
            let memberId = escapeHtml(`@_discord_${id}:${this.opts.domain}`);
            let memberName = memberId;
            const mxids = await this.opts.bot.store.get_discord_user_mxids(id);
            if (mxids.length > 0) {
                const mxid = mxids[0];
                const profile = await this.opts.bot.bridge.getClientFactory().getClientAs().getProfileInfo(mxid);
                memberName = profile.displayname || mxid;
                memberId = mxid;
            }
            else {
                if (member) {
                    memberName = escapeHtml(member.user.username);
                }
            }
            const memberStr = `<a href="${MATRIX_TO_LINK}${memberId}">${memberName}</a>`;
            content = content.replace(results[0], memberStr);
            results = USER_REGEX_POSTMARK.exec(content);
        }
        return content;
    }

    public ReplaceRoles(content: string, msg: Discord.Message): string {
        let results = ROLES_REGEX.exec(content);
        while (results !== null) {
          const id = results[1];
          const role = msg.guild.roles.get(id);
          content = content.replace(results[0], `@${role.name}`);
          results = ROLES_REGEX.exec(content);
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
                log.warn("MessageProcessor",
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
                    `<img alt="${name}" src="${mxcUrl}" style="height: ${EMOJI_SIZE};"/>`);
            } catch (ex) {
                log.warn("MessageProcessor",
                    `Could not insert emoji ${id} for msg ${msg.id} in guild ${msg.guild.id}: ${ex}`,
                );
            }
            results = EMOJI_REGEX_POSTMARK.exec(content);
        }
        return content;
    }
}
