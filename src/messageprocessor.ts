import * as Discord from "discord.js";
import * as marked from "marked";
import * as log from "npmlog";
import { DiscordBot } from "./bot";
import * as escapeStringRegexp from "escape-string-regexp";

const USER_REGEX = /<@!?([0-9]*)>/g;
const CHANNEL_REGEX = /<#?([0-9]*)>/g;
const EMOJI_REGEX = /<:\w+:?([0-9]*)>/g;
const MATRIX_TO_LINK = "https://matrix.to/#/";

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
        // Replace Users
        let content = msg.content;
        content = this.ReplaceMembers(content, msg);
        content = this.ReplaceChannels(content, msg);
        content = await this.ReplaceEmoji(content, msg);
        // Replace channels
        result.body = content;
        result.formattedBody = marked(content);
        return result;
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

    public ReplaceChannels(content: string, msg: Discord.Message): string {
        let results = CHANNEL_REGEX.exec(content);
        while (results !== null) {
          const id = results[1];
          const channel = msg.guild.channels.get(id);
          const roomId = `#_discord_${msg.guild.id}_${id}:${this.opts.domain}`;
          const channelStr = channel ? "#" + channel.name : "#" + id;
          content = content.replace(results[0], `[${channelStr}](${MATRIX_TO_LINK}${roomId})`);
          results = CHANNEL_REGEX.exec(content);
        }
        return content;
    }

    public async ReplaceEmoji(content: string, msg: Discord.Message): Promise<string> {
        let results = EMOJI_REGEX.exec(content);
        while (results !== null) {
          const id = results[1];
          try {
              const mxcUrl = await this.bot.GetGuildEmoji(msg.guild, id);
              content = content.replace(results[0], `![${id}](${mxcUrl})`);
          } catch (ex) {
              log.warn("MessageProcessor",
              `Could not insert emoji ${id} for msg ${msg.id} in guild ${msg.guild.id}: ${ex}`,
            );
          }
          results = EMOJI_REGEX.exec(content);
        }
        return content;
    }

    public FindMentionsInPlainBody(body: string, members: Discord.GuildMember[]): string {
      for (const member of members) {
        body = body.replace(
            new RegExp(`(^| |\\t)(${escapeStringRegexp(member.displayName)})($| |\\t)` , "mg"), ` <@!${member.id}>`,
        );
      }
      return body;
    }
}
