import { DiscordBot } from "./bot";
import * as Discord from "discord.js";
import { Util, ICommandActions, ICommandParameters, ICommandPermissonCheck } from "./util";
import { Bridge } from "matrix-appservice-bridge";
export class DiscordCommandHandler {
    constructor(
        private bridge: Bridge,
        private discord: DiscordBot,
    ) { }

    public async Process(msg: Discord.Message) {
        if (!(msg.channel as Discord.TextChannel).guild) {
            await msg.channel.send("**ERROR:** only available for guild channels");
            return;
        }

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

        const permissionCheck: ICommandPermissonCheck = async (permission) => {
            return msg.member.hasPermission(permission as Discord.PermissionResolvable);
        }

        const reply = await Util.ParseCommand("!matrix", msg.content, actions, parameters, permissionCheck);
        await msg.channel.send(reply);
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
