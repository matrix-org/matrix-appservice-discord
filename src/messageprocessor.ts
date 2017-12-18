import * as Discord from "discord.js";
import * as marked from "marked";
import * as log from "npmlog";
import { DiscordStore } from "./store";
import { DiscordBot } from "./bot";
import * as escapeStringRegexp from "escape-string-regexp";

const USER_REGEX = /<@!?([0-9]*)>/g;
const CHANNEL_REGEX = /<#?([0-9]*)>/g;
const ROLES_REGEX = /<@&?([0-9]*)>/g;
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
        // Replace embeds.
        let content = msg.content;
        content = this.InsertEmbeds(content, msg);

        // Replace Users
        content = await this.ReplaceMembers(content, msg);
        content = this.ReplaceChannels(content, msg);
        content = this.ReplaceRoles(content, msg);
        content = await this.ReplaceEmoji(content, msg);
        // Replace channels
        result.body = content;
        result.formattedBody = marked(content);
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

    public async ReplaceMembers(content: string, msg: Discord.Message): Promise<string> {
        let results = USER_REGEX.exec(content);
        while (results !== null) {
          const id = results[1];
          const member = msg.guild.members.get(id);
          const memberId = `@_discord_${id}:${this.opts.domain}`;
          let memberStr = member ? `[${member.user.username}#${member.user.discriminator}](${MATRIX_TO_LINK}${memberId})` : memberId;
          const mxids = await this.bot.store.get_discord_user_mxids(id);
          if (mxids.length > 0) {
            const mxid = mxids[0];
            const profile = await this.bot.bridge.getClientFactory().getClientAs().getProfileInfo(mxid);
            const name = profile.displayname || mxid;
            memberStr = `[${name}](${MATRIX_TO_LINK}${mxid})`;
          }
          content = content.replace(results[0], memberStr);
          results = USER_REGEX.exec(content);
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
        const matcher = escapeStringRegexp(member.user.username + "#" + member.user.discriminator);
        body = body.replace(
            new RegExp(
                `\\b(${matcher})(?=\\b)`
                , "mig"), `<@!${member.id}>`,
        );
      }
      return body;
    }
}
