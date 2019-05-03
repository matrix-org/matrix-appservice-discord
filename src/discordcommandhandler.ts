import { DiscordBot } from "./bot";
import * as Discord from "discord.js";
import { Uitl, ICommandActions, ICommandParameters } from "./util";
export class DiscordCommandHandler {
    constructor(
        private discord: DiscordBot;
    ) { }

    public async Process(msg: Discord.Message) {
        if (!(msg.channel as Discord.TextChannel).guild) {
            await msg.channel.send("**ERROR:** only available for guild channels");
            return;
        }

        const {command, args} = Util.MsgToArgs(msg.content, "!matrix");

        const intent = this.bridge.getIntent();

        const actions: ICommandActions = {
            ban: {
                description: "Bans a user on the matrix side",
                params: ["name"],
                permission: "BAN_MEMBERS",
                run: this.ModerationActionGenerator(msg.channel as Discord.TextChannel, "ban", "Banned"),
            },
            kick: {
                description: "Kicks a user on the matrix side",
                params: ["name"],
                permission: "KICK_MEMBERS",
                run: this.ModerationActionGenerator(msg.channel as Discord.TextChannel, "kick", "Kicked"),
            },
            unban: {
                description: "Unbans a user on the matrix side",
                params: ["name"],
                permission: "BAN_MEMBERS",
                run: this.ModerationActionGenerator(msg.channel as Discord.TextChannel, "unban", "Unbanned"),
            },
        };

        const parameters: ICommandParameters = {
            name: {
                description: "The display name or mxid of a matrix user",
                get: async (name) => {
                    const channelMxids = await this.discord.ChannelSyncroniser.GetRoomIdsFromChannel(msg.channel);
                    const mxUserId = await Util.GetMxidFromName(intent, name, channelMxids);
                    return mxUserId;
                },
            },
        };

        if (command === "help") {
            let replyHelpMessage = "Available Commands:\n";
            for (const actionKey of Object.keys(actions)) {
                const action = actions[actionKey];
                if (!msg.member.hasPermission(action.permission as Discord.PermissionResolvable)) {
                    continue;
                }
                replyHelpMessage += " - `!matrix " + actionKey;
                for (const param of action.params) {
                    replyHelpMessage += ` <${param}>`;
                }
                replyHelpMessage += `\`: ${action.description}\n`;
            }
            replyHelpMessage += "\nParameters:\n";
            for (const parameterKey of Object.keys(parameters)) {
                const parameter = parameters[parameterKey];
                replyHelpMessage += ` - \`<${parameterKey}>\`: ${parameter.description}\n`;
            }
            await msg.channel.send(replyHelpMessage);
            return;
        }

        if (!actions[command]) {
            await msg.channel.send("**Error:** unknown command. Try `!matrix help` to see all commands");
            return;
        }

        if (!msg.member.hasPermission(actions[command].permission as Discord.PermissionResolvable)) {
            await msg.channel.send("**ERROR:** insufficiant permissions to use this matrix command");
            return;
        }

        let replyMessage = "";
        try {
            replyMessage = await Util.ParseCommand(actions[command], parameters, args);
        } catch (e) {
            replyMessage = "**ERROR:** " + e.message;
        }

        await msg.channel.send(replyMessage);
    }

    private ModerationActionGenerator(discordChannel: Discord.TextChannel, funcKey: string, action: string) {
        return async ({name}) => {
            let allChannelMxids: string[] = [];
            await Promise.all(discordChannel.guild.channels.map(async (chan) => {
                try {
                    const chanMxids = await this.discord.ChannelSyncroniser.GetRoomIdsFromChannel(chan);
                    allChannelMxids = allChannelMxids.concat(chanMxids);
                } catch (e) {
                    // pass, non-text-channel
                }
            }));
            let errorMsg = "";
            await Promise.all(allChannelMxids.map(async (chanMxid) => {
                const intent = this.bridge.getIntent();
                try {
                    await intent[funcKey](chanMxid, name);
                } catch (e) {
                    // maybe we don't have permission to kick/ban/unban...?
                    errorMsg += `\nCouldn't ${funcKey} ${name} from ${chanMxid}`;
                }
            }));
            if (errorMsg) {
                throw Error(errorMsg);
            }
            return `${action} ${name}`;
        };
    }
}
