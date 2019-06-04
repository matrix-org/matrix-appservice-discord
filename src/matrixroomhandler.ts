/*
Copyright 2018, 2019 matrix-appservice-discord

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
import {
    Bridge,
    RemoteRoom,
    thirdPartyLookup,
    thirdPartyProtocolResult,
    thirdPartyUserResult,
    thirdPartyLocationResult,
    ProvisionedRoom,
    Intent,
} from "matrix-appservice-bridge";
import { DiscordBridgeConfig } from "./config";

import * as Discord from "discord.js";
import { Util } from "./util";
import { Provisioner } from "./provisioner";
import { Log } from "./log";
const log = new Log("MatrixRoomHandler");
import { IMatrixEvent } from "./matrixtypes";
import { DbRoomStore, MatrixStoreRoom, RemoteStoreRoom } from "./db/roomstore";

const ICON_URL = "https://matrix.org/_matrix/media/r0/download/matrix.org/mlxoESwIsTbJrfXyAAogrNxA";
/* tslint:disable:no-magic-numbers */
const HTTP_UNSUPPORTED = 501;
const ROOM_NAME_PARTS = 2;
const PROVISIONING_DEFAULT_POWER_LEVEL = 50;
const PROVISIONING_DEFAULT_USER_POWER_LEVEL = 0;
const USERSYNC_STATE_DELAY_MS = 5000;
const ROOM_CACHE_MAXAGE_MS = 15 * 60 * 1000;

// Note: The schedule must not have duplicate values to avoid problems in positioning.
// Disabled because it complains about the values in the array
const JOIN_ROOM_SCHEDULE = [
    0,              // Right away
    1000,           // 1 second
    30000,          // 30 seconds
    300000,         // 5 minutes
    900000,         // 15 minutes
];
/* tslint:enable:no-magic-numbers */

export class MatrixRoomHandler {
    private botUserId: string;
    private botJoinedRooms: Set<string>; // roomids
    private botJoinedRoomsCacheUpdatedAt = 0;
    constructor(
        private discord: DiscordBot,
        private config: DiscordBridgeConfig,
        private provisioner: Provisioner,
        private bridge: Bridge,
        private roomStore: DbRoomStore) {
        this.botUserId = this.discord.BotUserId;
        this.botJoinedRooms = new Set();
    }

    public get ThirdPartyLookup(): thirdPartyLookup {
        return {
            getLocation: this.tpGetLocation.bind(this),
            getProtocol: this.tpGetProtocol.bind(this),
            getUser: this.tpGetUser.bind(this),
            parseLocation: this.tpParseLocation.bind(this),
            parseUser: this.tpParseUser.bind(this),
            protocols: ["discord"],
        };
    }

    public async OnAliasQueried(alias: string, roomId: string) {
        log.verbose(`Got OnAliasQueried for ${alias} ${roomId}`);
        let channel: Discord.GuildChannel;
        try {
            // We previously stored the room as an alias.
            const entry = (await this.roomStore.getEntriesByMatrixId(alias))[0];
            if (!entry) {
                throw new Error("Entry was not found");
            }
            // Remove the old entry
            await this.roomStore.removeEntriesByMatrixRoomId(
                entry.matrix!.roomId,
            );
            await this.roomStore.linkRooms(
                new MatrixStoreRoom(roomId),
                entry.remote!,
            );
            channel = await this.discord.GetChannelFromRoomId(roomId) as Discord.GuildChannel;
        } catch (err) {
            log.error(`Cannot find discord channel for ${alias} ${roomId}`, err);
            throw err;
        }

        // Fire and forget RoomDirectory mapping
        this.bridge.getIntent().getClient().setRoomDirectoryVisibilityAppService(
            channel.guild.id,
            roomId,
            "public",
        );
        await this.discord.ChannelSyncroniser.OnUpdate(channel);
        const promiseList: Promise<void>[] = [];
        // Join a whole bunch of users.
        // We delay the joins to give some implementations a chance to breathe
        let delay = this.config.limits.roomGhostJoinDelay;
        for (const member of (channel as Discord.TextChannel).members.array()) {
            if (member.id === this.discord.GetBotId()) {
              continue;
            }
            promiseList.push((async () => {
                await Util.DelayedPromise(delay);
                log.info(`UserSyncing ${member.id}`);
                try {
                    // Ensure the profile is up to date.
                    await this.discord.UserSyncroniser.OnUpdateUser(member.user);
                } catch (err) {
                    log.warn(`Failed to update profile of user ${member.id}`, err);
                }
                log.info(`Joining ${member.id} to ${roomId}`);

                await this.joinRoom(this.discord.GetIntentFromDiscordMember(member), roomId, member);
            })());
            delay += this.config.limits.roomGhostJoinDelay;
        }
        await Promise.all(promiseList);
    }

    public async OnAliasQuery(alias: string, aliasLocalpart: string): Promise<ProvisionedRoom> {
        log.info("Got request for #", aliasLocalpart);
        const srvChanPair = aliasLocalpart.substr("_discord_".length).split("_", ROOM_NAME_PARTS);
        if (srvChanPair.length < ROOM_NAME_PARTS || srvChanPair[0] === "" || srvChanPair[1] === "") {
            log.warn(`Alias '${aliasLocalpart}' was missing a server and/or a channel`);
            return;
        }
        try {
            const result = await this.discord.LookupRoom(srvChanPair[0], srvChanPair[1]);
            log.info("Creating #", aliasLocalpart);
            return this.createMatrixRoom(result.channel, alias, aliasLocalpart);
        } catch (err) {
            log.error(`Couldn't find discord room '${aliasLocalpart}'.`, err);
        }

    }

    public async tpGetProtocol(protocol: string): Promise<thirdPartyProtocolResult> {
        return {
            field_types: {
                // guild_name: {
                //   regexp: "\S.{0,98}\S",
                //   placeholder: "Guild",
                // },
                channel_id: {
                    placeholder: "",
                    regexp: "[0-9]*",
                },
                channel_name: {
                    placeholder: "#Channel",
                    regexp: "[A-Za-z0-9_\-]{2,100}",
                },
                discriminator: {
                    placeholder: "1234",
                    regexp: "[0-9]{4}",
                },
                guild_id: {
                    placeholder: "",
                    regexp: "[0-9]*",
                },
                username: {
                    placeholder: "Username",
                    regexp: "[A-Za-z0-9_\-]{2,100}",
                },
            },
            instances: this.discord.GetGuilds().map((guild) => {
                return {
                    bot_user_id: this.botUserId,
                    desc: guild.name,
                    fields: {
                        guild_id: guild.id,
                    },
                    icon: guild.iconURL || ICON_URL, // TODO: Use icons from our content repo. Potential security risk.
                    network_id: guild.id,
                };
            }),
            location_fields: ["guild_id", "channel_name"],
            user_fields: ["username", "discriminator"],
        };
    }

    // tslint:disable-next-line no-any
    public async tpGetLocation(protocol: string, fields: any): Promise<thirdPartyLocationResult[]> {
        log.info("Got location request ", protocol, fields);
        const chans = this.discord.ThirdpartySearchForChannels(fields.guild_id, fields.channel_name);
        return chans;
    }

    public async tpParseLocation(alias: string): Promise<thirdPartyLocationResult[]>  {
        throw {err: "Unsupported", code: HTTP_UNSUPPORTED};
    }

    // tslint:disable-next-line no-any
    public async tpGetUser(protocol: string, fields: any): Promise<thirdPartyUserResult[]> {
        log.info("Got user request ", protocol, fields);
        throw {err: "Unsupported", code: HTTP_UNSUPPORTED};
    }

    public async tpParseUser(userid: string): Promise<thirdPartyUserResult[]> {
        throw {err: "Unsupported", code: HTTP_UNSUPPORTED};
    }

    private async joinRoom(intent: Intent, roomIdOrAlias: string, member?: Discord.GuildMember): Promise<void> {
        let currentSchedule = JOIN_ROOM_SCHEDULE[0];
        const doJoin = async () => {
            await Util.DelayedPromise(currentSchedule);
            if (member) {
                await this.discord.UserSyncroniser.JoinRoom(member, roomIdOrAlias);
            } else {
                await intent.getClient().joinRoom(roomIdOrAlias);
            }
        };
        const errorHandler = async (err) => {
            log.error(`Error joining room ${roomIdOrAlias} as ${intent.getClient().getUserId()}`);
            log.error(err);
            const idx = JOIN_ROOM_SCHEDULE.indexOf(currentSchedule);
            if (idx === JOIN_ROOM_SCHEDULE.length - 1) {
                log.warn(`Cannot join ${roomIdOrAlias} as ${intent.getClient().getUserId()}`);
                throw new Error(err);
            } else {
                currentSchedule = JOIN_ROOM_SCHEDULE[idx + 1];
                try {
                    await doJoin();
                } catch (e) {
                    await errorHandler(e);
                }
            }
        };

        try {
            await doJoin();
        } catch (e) {
            await errorHandler(e);
        }
    }

    private async createMatrixRoom(channel: Discord.TextChannel,
                                   alias: string, aliasLocalpart: string): ProvisionedRoom {
        const remote = new RemoteStoreRoom(`discord_${channel.guild.id}_${channel.id}`, {
            discord_channel: channel.id,
            discord_guild: channel.guild.id,
            discord_type: "text",
            update_icon: 1,
            update_name: 1,
            update_topic: 1,
        });
        const creationOpts = {
            initial_state: [
                {
                    content: {
                        join_rule: "public",
                    },
                    state_key: "",
                    type: "m.room.join_rules",
                },
            ],
            room_alias_name: aliasLocalpart,
            visibility: this.config.room.defaultVisibility,
        };
        // We need to tempoarily store this until we know the room_id.
        await this.roomStore.linkRooms(
            new MatrixStoreRoom(alias),
            remote,
        );
        return {
            creationOpts,
        } as ProvisionedRoom;
    }
}
