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

import * as Discord from "@mx-puppet/better-discord.js";
import { DiscordBot } from "./bot";
import { Util, ICommandActions, ICommandParameters, CommandPermissonCheck } from "./util";
import { Log } from "./log";
import { Appservice } from "matrix-bot-sdk";
import { DbRoomStore } from "./db/roomstore";
import { DiscordBridgeConfig } from "./config";

const log = new Log("DiscordCommandHandler");

export class DiscordCommandHandler {
    constructor(
        private bridge: Appservice,
        private discord: DiscordBot,
        private roomStore: DbRoomStore,
        private config:DiscordBridgeConfig
    ) { }

    public async Process(msg: Discord.Message) {
        const chan = msg.channel as Discord.TextChannel;
        if (!chan.guild) {
            await msg.channel.send("**ERROR:** only available for guild channels");
            return;
        }
        if (!msg.member) {
            await msg.channel.send("**ERROR:** could not determine message member");
            return;
        }

        const discordMember = msg.member;

        const intent = this.bridge.botIntent;

        const actions: ICommandActions = {
            approve: {
                description: "Approve a pending bridge request",
                params: [],
                permission: "MANAGE_WEBHOOKS",
                run: async () => {
                    if (await this.discord.Provisioner.MarkApproved(chan, discordMember, true)) {
                        return "Thanks for your response! The matrix bridge has been approved.";
                    } else {
                        return "Thanks for your response, however" +
                            " it has arrived after the deadline - sorry!";
                    }
                },
            },
            ban: {
                description: "Bans a user on the matrix side",
                params: ["name"],
                permission: "BAN_MEMBERS",
                run: this.ModerationActionGenerator(chan, "ban"),
            },
            deny: {
                description: "Deny a pending bridge request",
                params: [],
                permission: "MANAGE_WEBHOOKS",
                run: async () => {
                    if (await this.discord.Provisioner.MarkApproved(chan, discordMember, false)) {
                        return "Thanks for your response! The matrix bridge has been declined.";
                    } else {
                        return "Thanks for your response, however" +
                            " it has arrived after the deadline - sorry!";
                    }
                },
            },
            kick: {
                description: "Kicks a user on the matrix side",
                params: ["name"],
                permission: "KICK_MEMBERS",
                run: this.ModerationActionGenerator(chan, "kick"),
            },
            unban: {
                description: "Unbans a user on the matrix side",
                params: ["name"],
                permission: "BAN_MEMBERS",
                run: this.ModerationActionGenerator(chan, "unban"),
            },
            unbridge: {
                description: "Unbridge matrix rooms from this channel",
                params: [],
                permission: ["MANAGE_WEBHOOKS", "MANAGE_CHANNELS"],
                run: async () => this.UnbridgeChannel(chan),
            },
            bridge: {
                description:"Bridges this room to a Matrix channel",
                params:["roomid"],
                permission:["MANAGE_WEBHOOKS", "MANAGE_CHANNELS"],
                run: async ({roomid}) => this.BridgeChannel(roomid,chan),
            }
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
            roomid: {
                description:"The roomid of matrix room",
                get: async (roomid) => {
                    return roomid;
                }
            }
        };

        const permissionCheck: CommandPermissonCheck = async (permission: string|string[]) => {
            if (!Array.isArray(permission)) {
                permission = [permission];
            }
            return permission.every((p) => discordMember.hasPermission(p as Discord.PermissionResolvable));
        };

        const reply = await Util.ParseCommand("!matrix", msg.content, actions, parameters, permissionCheck);
        await msg.channel.send(reply);
    }

    private ModerationActionGenerator(discordChannel: Discord.TextChannel, funcKey: "kick"|"ban"|"unban") {
        return async ({name}) => {
            let allChannelMxids: string[] = [];
            await Promise.all(discordChannel.guild.channels.cache.map(async (chan) => {
                try {
                    const chanMxids = await this.discord.ChannelSyncroniser.GetRoomIdsFromChannel(chan);
                    allChannelMxids = allChannelMxids.concat(chanMxids);
                } catch (e) {
                    // pass, non-text-channel
                }
            }));
            let errorMsg = "";
            await Promise.all(allChannelMxids.map(async (chanMxid) => {
                try {
                    await this.bridge.botIntent.underlyingClient[funcKey + "User"](chanMxid, name);
                } catch (e) {
                    // maybe we don't have permission to kick/ban/unban...?
                    errorMsg += `\nCouldn't ${funcKey} ${name} from ${chanMxid}`;
                }
            }));
            if (errorMsg) {
                throw Error(errorMsg);
            }
            const action = {
                ban: "Banned",
                kick: "Kicked",
                unban: "Unbanned",
            }[funcKey];
            return `${action} ${name}`;
        };
    }

    private async UnbridgeChannel(channel: Discord.TextChannel): Promise<string> {
        try {
            await this.discord.Provisioner.UnbridgeChannel(channel);
            return "This channel has been unbridged";
        } catch (err) {
            if (err.message === "Channel is not bridged") {
                return "This channel is not bridged to a plumbed matrix room";
            }
            log.error("Error while unbridging room " + channel.id);
            log.error(err);
            return "There was an error unbridging this room. " +
                "Please try again later or contact the bridge operator.";
        }
    }

    private async BridgeChannel(roomid:string,channel: Discord.TextChannel): Promise<string> {
        try {
            const roomRes = await this.roomStore.getEntriesByRemoteRoomData({
                discord_channel: channel.id,
                discord_guild: channel.guild.id,
                plumbed: true,
            });
            if(!roomid){
                return ""
            }
            if(roomRes.length > 0){
                return "This guild has already been bridged to a matrix room";
            }
            if (await this.discord.Provisioner.RoomCountLimitReached(this.config.limits.roomCount)) {
                log.info(`Room count limit (value: ${this.config.limits.roomCount}) reached: Rejecting command to bridge new matrix room ${roomid} to ${channel.guild.id}/${channel.id}`);
                return `This bridge has reached its room limit of ${this.config.limits.roomCount}. Unbridge another room to allow for new connections.`;
            }
            try {

                log.info(`Bridging discord room ${channel.guild.id}/${channel.id} to ${roomid}`);
                await channel.send(
                    "I'm asking permission from the channel administrators to make this bridge."
                );

                await this.discord.Provisioner.AskMatrixPermission(this.bridge,channel,roomid);
                await this.discord.Provisioner.BridgeMatrixRoom(channel, roomid);
                return "I have bridged this room to your channel";
            } catch (err) {
                if (err.message === "Timed out waiting for a response from the Matrix owners."
                    || err.message === "The bridge has been declined by the matrix channel.") {
                    return err.message;
                }

                log.error(`Error bridging ${roomid} to ${channel.guild.id}/${channel.id}`);
                log.error(err);
                return "There was a problem bridging that channel - has the guild owner approved the bridge?";
            }
        } catch (err) {
           return ""
        }
    }
}
