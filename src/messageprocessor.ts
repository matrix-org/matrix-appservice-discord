import * as Discord from "discord.js";
import * as marked from "marked";

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
    public formatted_body: string;
    public body: string;
}

export class MessageProcessor {
    readonly opts: MessageProcessorOpts;

    constructor (opts: MessageProcessorOpts) {
        this.opts = opts;
    }

    public FormatDiscordMessage(msg: Discord.Message): MessageProcessorMatrixResult {
        let result = new MessageProcessorMatrixResult();
        // Replace Users
        let content = msg.content;
        content = this.ReplaceMembers(content, msg);
        content = this.ReplaceChannels(content, msg);
        //content = this.ReplaceEmoji(content, msg);
        // Replace channels
        result.body = content;
        result.formatted_body = marked(content);
        return result;
    }

    public ReplaceMembers(content:string, msg: Discord.Message): string {
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

    public ReplaceEmoji(content: string, msg: Discord.Message): string {
        // let results = EMOJI_REGEX.exec(content);
        // while (results !== null) {
        //   const id = results[1];
        // //   const channel = msg.guild.channels.get(id);
        // //   const roomId = `#_discord_${msg.guild.id}_${id}:${this.opts.domain}`;
        // //   const channelStr = channel ? "#" + channel.name : "#" + id;
        // //   content = content.replace(results[0], `[${channelStr}](${MATRIX_TO_LINK}${roomId})`);
        //   results = EMOJI_REGEX.exec(content);
        // }
        return content;
    }
}
