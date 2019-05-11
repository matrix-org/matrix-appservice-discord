/*
Copyright 2019 matrix-appservice-discord

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { DiscordBot } from "./bot";
import * as Discord from "discord.js";
import { Util, ICommandActions, ICommandParameters, CommandPermissonCheck } from "./util";
import { Bridge } from "matrix-appservice-bridge";
export class DiscordCommandHandler {
    constructor(
        private bridge: Bridge,
        private discord: DiscordBot,
    ) { }

    public async Process(msg: Discord.Message) {
        const chan = msg.channel as Discord.TextChannel;
        if (!chan.guild) {
            await msg.channel.send("**ERROR:** only available for guild channels");
            return;
        }

        const intent = this.bridge.getIntent();

        const actions: ICommandActions = {
            approve: {
                description: "Approve a pending bridge request",
                params: [],
                permission: "MANAGE_WEBHOOKS",
                run: async () => {
                    if (await this.discord.Provisioner.MarkApproved(chan, msg.member, true)) {
                        return "Thanks for your response! The matrix bridge has been approved";
                    } else {
                        return "Thanks for your response, however" +
                            "the time for responses has expired - sorry!";
                    }
                },
            },
            ban: {
                description: "Bans a user on the matrix side",
                params: ["name"],
                permission: "BAN_MEMBERS",
                run: this.ModerationActionGenerator(chan, "ban", "Banned"),
            },
            deny: {
                description: "Deny a pending bridge request",
                params: [],
                permission: "MANAGE_WEBHOOKS",
                run: async () => {
                    if (await this.discord.Provisioner.MarkApproved(chan, msg.member, false)) {
                        return "Thanks for your response! The matrix bridge has been declined";
                    } else {
                        return "Thanks for your response, however" +
                            "the time for responses has expired - sorry!";
                    }
                },
            },
            kick: {
                description: "Kicks a user on the matrix side",
                params: ["name"],
                permission: "KICK_MEMBERS",
                run: this.ModerationActionGenerator(chan, "kick", "Kicked"),
            },
            unban: {
                description: "Unbans a user on the matrix side",
                params: ["name"],
                permission: "BAN_MEMBERS",
                run: this.ModerationActionGenerator(chan, "unban", "Unbanned"),
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

        const permissionCheck: CommandPermissonCheck = async (permission) => {
            return msg.member.hasPermission(permission as Discord.PermissionResolvable);
        };

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
