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
import * as Discord from "better-discord.js";
import { Util, ICommandActions, ICommandParameters, CommandPermissonCheck } from "./util";
import { Log } from "./log";
import { Appservice, Presence } from "matrix-bot-sdk";
import { DiscordBridgeConfig } from './config';

const log = new Log("DiscordCommandHandler");

export class DiscordCommandHandler {
    constructor(
        private bridge: Appservice,
        private discord: DiscordBot,
        private config: DiscordBridgeConfig,
    ) { }

    /**
     * @param msg Message to process.
     * @returns The message the bot replied with.
     */
    public async Process(msg: Discord.Message) {
        const chan = msg.channel as Discord.TextChannel;
        if (!chan.guild) {
            return await msg.channel.send("**ERROR:** only available for guild channels");
        }
        if (!msg.member) {
            return await msg.channel.send("**ERROR:** could not determine message member");
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
                        return "Thanks for your response! The Matrix bridge has been approved.";
                    } else {
                        return "Thanks for your response, however" +
                            " it has arrived after the deadline - sorry!";
                    }
                },
            },
            ban: {
                description: "Bans a user on the Matrix side",
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
                        return "Thanks for your response! The Matrix bridge has been declined.";
                    } else {
                        return "Thanks for your response, however" +
                            " it has arrived after the deadline - sorry!";
                    }
                },
            },
            kick: {
                description: "Kicks a user on the Matrix side",
                params: ["name"],
                permission: "KICK_MEMBERS",
                run: this.ModerationActionGenerator(chan, "kick"),
            },
            unban: {
                description: "Unbans a user on the Matrix side",
                params: ["name"],
                permission: "BAN_MEMBERS",
                run: this.ModerationActionGenerator(chan, "unban"),
            },
            unbridge: {
                description: "Unbridge Matrix rooms from this channel",
                params: [],
                permission: ["MANAGE_WEBHOOKS", "MANAGE_CHANNELS"],
                run: async () => this.UnbridgeChannel(chan),
            },
            listusers: {
                description: "List users on the Matrix side of the bridge",
                params: [],
                permission: [],
                run: async () => this.ListMatrixMembers(chan)
            }
        };

        const parameters: ICommandParameters = {
            name: {
                description: "The display name or mxid of a Matrix user",
                get: async (name) => {
                    const channelMxids = await this.discord.ChannelSyncroniser.GetRoomIdsFromChannel(msg.channel);
                    const mxUserId = await Util.GetMxidFromName(intent, name, channelMxids);
                    return mxUserId;
                },
            },
        };

        const permissionCheck: CommandPermissonCheck = async (permission: string|string[]) => {
            if (!Array.isArray(permission)) {
                permission = [permission];
            }
            return permission.every((p) => discordMember.hasPermission(p as Discord.PermissionResolvable));
        };

        const reply = await Util.ParseCommand("!matrix", msg.content, actions, parameters, permissionCheck);
        return await msg.channel.send(reply);
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
                return "This channel is not bridged to a plumbed Matrix room";
            }
            log.error("Error while unbridging room " + channel.id);
            log.error(err);
            return "There was an error unbridging this room. " +
                "Please try again later or contact the bridge operator.";
        }
    }

    private async ListMatrixMembers(channel: Discord.TextChannel): Promise<string> {
        const chanMxids = await this.discord.ChannelSyncroniser.GetRoomIdsFromChannel(channel);
        const members: {
            mxid: string;
            displayName?: string;
            presence?: Presence;
        }[] = [];
        const errorMessages: string[] = [];

        await Promise.all(chanMxids.map(async (chanMxid) => {
            const { underlyingClient } = this.bridge.botIntent;

            try {
                const memberProfiles = await underlyingClient.getJoinedRoomMembersWithProfiles(chanMxid);
                const userProfiles = Object.keys(memberProfiles)
                    .filter((mxid) => !this.bridge.isNamespacedUser(mxid))
                    .map((mxid) => ({ mxid, displayName: memberProfiles[mxid].display_name }));

                members.push(...userProfiles);
            } catch (e) {
                errorMessages.push(`Couldn't get members from ${chanMxid}`);
            }
        }));

        if (errorMessages.length) {
            throw Error(errorMessages.join('\n'));
        }

        if (!this.config.bridge.disablePresence) {

            await Promise.all(members.map(async (member) => {
                try {
                    const presence = await this.bridge.botClient.getPresenceStatusFor(member.mxid);
                    member.presence = presence;
                } catch (e) {
                    errorMessages.push(`Couldn't get presence for ${member.mxid}`);
                }
            }));
        }

        if (errorMessages.length) {
            throw Error(errorMessages.join('\n'));
        }

        const length = members.length;
        const formatter = new Intl.NumberFormat('en-US');
        const formattedTotalMembers = formatter.format(length);
        let userCount: string;

        if (length === 1) {
            userCount = `is **1** user`;
        } else {
            userCount = `are **${formattedTotalMembers}** users`;
        }

        const userCountMessage = `There ${userCount} on the Matrix side.`;

        if (length === 0) {
            return userCountMessage;
        }

        members.sort((a, b) => {
            const aPresenceState = a.presence?.state ?? "unknown";
            const bPresenceState = b.presence?.state ?? "unknown";

            if (aPresenceState === bPresenceState) {
                const aDisplayName = a.displayName;
                const bDisplayName = b.displayName;

                if (aDisplayName === bDisplayName) {
                    return a.mxid.localeCompare(b.mxid);
                }

                if (!aDisplayName) {
                    return 1;
                }

                if (!bDisplayName) {
                    return -1;
                }

                return aDisplayName.localeCompare(bDisplayName, 'en', { sensitivity: "base" });
            }

            const presenseOrdinal = {
                "online": 0,
                "unavailable": 1,
                "offline": 2,
                "unknown": 3
            };

            return presenseOrdinal[aPresenceState] - presenseOrdinal[bPresenceState];
        });

        /** Reserve characters for the worst-case "and x others…" line at the end if there are too many members. */
        const reservedChars = `\n_and ${formattedTotalMembers} others…_`.length;
        let message = `${userCountMessage} Matrix users in ${channel.toString()} may not necessarily be in the other bridged channels in the server.\n`;

        for (let i = 0; i < length; i++) {
            const { mxid, displayName, presence } = members[i];
            let line = "• ";
            line += (displayName) ? `${displayName} (${mxid})` : mxid;

            if (!this.config.bridge.disablePresence) {
                const state = presence?.state ?? "unknown";
                // Use Discord terminology for Away
                const stateDisplay = (state === "unavailable") ? "idle" : state;
                line += ` - ${stateDisplay.charAt(0).toUpperCase() + stateDisplay.slice(1)}`;
            }

            if (2000 - message.length - reservedChars < line.length) {
                const remaining = length - i;
                return message + `\n_and ${formatter.format(remaining)} others…_`;
            }

            message += `\n${line}`;
        }

        return message;
    }
}
