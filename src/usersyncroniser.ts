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

import { User, GuildMember } from "discord.js";
import { DiscordBot } from "./bot";
import { Util } from "./util";
import { Bridge, Intent, MatrixUser } from "matrix-appservice-bridge";
import { DiscordBridgeConfig } from "./config";
import { Log } from "./log";
import { IMatrixEvent } from "./matrixtypes";
import { DbUserStore, RemoteUser } from "./db/userstore";

const log = new Log("UserSync");

const DEFAULT_USER_STATE = {
    avatarId: "",
    avatarUrl: null,
    createUser: false,
    displayName: null,
    id: null,
    mxUserId: null,
    removeAvatar: false,
};

const DEFAULT_GUILD_STATE = {
    displayName: "",
    id: null,
    mxUserId: null,
    roles: [],
};

export interface IUserState {
    avatarId: string;
    avatarUrl: string | null;
    createUser: boolean;
    displayName: string | null;
    id: string;
    mxUserId: string;
    removeAvatar: boolean; // If the avatar has been removed from the user.
}

export interface IGuildMemberRole {
    name: string;
    color: number;
    position: number;
}

export interface IGuildMemberState {
    bot: boolean;
    displayColor?: number;
    displayName: string;
    id: string;
    mxUserId: string;
    roles: IGuildMemberRole[];
    username: string;
}

/**
 * Class that syncronises Discord users with their bridge ghost counterparts.
 * Also handles member events that may occur when using guild nicknames.
 */
export class UserSyncroniser {

    public static readonly ERR_NO_ERROR = "";
    public static readonly ERR_USER_NOT_FOUND = "user_not_found";
    public static readonly ERR_CHANNEL_MEMBER_NOT_FOUND = "channel_or_member_not_found";
    public static readonly ERR_NEWER_EVENT = "newer_state_event_arrived";

    // roomId+userId => ev
    public userStateHold: Map<string, IMatrixEvent>;
    constructor(
        private bridge: Bridge,
        private config: DiscordBridgeConfig,
        private discord: DiscordBot,
        private userStore: DbUserStore) {
        this.userStateHold = new Map<string, IMatrixEvent>();
    }

    /**
     * Should be called when the discord user is updated.
     * @param {module:discord.js.User} Old user object. If not used, new user object.
     * @param {module:discord.js.User} New user object
     * @returns {Promise<void>}
     * @constructor
     */
    public async OnUpdateUser(discordUser: User, webhookID?: string) {
        const userState = await this.GetUserUpdateState(discordUser, webhookID);
        try {
            await this.ApplyStateToProfile(userState);
        } catch (e) {
            log.error("Failed to update user's profile", e);
        }
    }

    public async ApplyStateToProfile(userState: IUserState) {
        const intent = this.bridge.getIntent(userState.mxUserId);
        let userUpdated = false;
        let remoteUser: RemoteUser;
        if (userState.createUser) {
            /* NOTE: Setting the displayname/avatar will register the user if they don't exist */
            log.info(`Creating new user ${userState.mxUserId}`);
            remoteUser = new RemoteUser(userState.id);
            await this.userStore.linkUsers(
                userState.mxUserId.substr("@".length),
                userState.id,
            );

        } else {
            const rUser = await this.userStore.getRemoteUser(userState.id);
            remoteUser = rUser ? rUser : new RemoteUser(userState.id);
        }

        if (userState.displayName !== null) {
            log.verbose(`Updating displayname for ${userState.mxUserId} to "${userState.displayName}"`);
            await intent.setDisplayName(userState.displayName);
            remoteUser.displayname = userState.displayName;
            userUpdated = true;
        }

        if (userState.avatarUrl !== null) {
            log.verbose(`Updating avatar_url for ${userState.mxUserId} to "${userState.avatarUrl}"`);
            const avatarMxc = await Util.UploadContentFromUrl(
                userState.avatarUrl,
                intent,
                userState.avatarId,
            );
            await intent.setAvatarUrl(avatarMxc.mxcUrl);
            remoteUser.avatarurl = userState.avatarUrl;
            remoteUser.avatarurlMxc = avatarMxc.mxcUrl;
            userUpdated = true;
        }

        if (userState.removeAvatar) {
            log.verbose(`Clearing avatar_url for ${userState.mxUserId} to "${userState.avatarUrl}"`);
            await intent.setAvatarUrl(null);
            remoteUser.avatarurl = null;
            remoteUser.avatarurlMxc = null;
            userUpdated = true;
        }

        if (userUpdated) {
            await this.userStore.setRemoteUser(remoteUser);
            await this.UpdateStateForGuilds(remoteUser);
        }
    }

    public async JoinRoom(member: GuildMember | User, roomId: string, webhookID?: string) {
        let state: IGuildMemberState;
        if (member instanceof User) {
            state = await this.GetUserStateForDiscordUser(member, webhookID);
        } else {
            state = await this.GetUserStateForGuildMember(member);
        }
        log.info(`Joining ${state.id} in ${roomId}`);
        const guildId = member instanceof User ? undefined : member.guild.id;
        try {
            await this.ApplyStateToRoom(state, roomId, guildId);
        } catch (e) {
            if (e.errcode !== "M_FORBIDDEN") {
                log.error(`Failed to join ${state.id} to ${roomId}`, e);
                throw e;
            } else {
                log.info(`User not in room ${roomId}, inviting`);
                try {
                    await this.bridge.getIntent().invite(roomId, state.mxUserId);
                    await this.ApplyStateToRoom(state, roomId, guildId);
                } catch (e) {
                    log.error(`Failed to join ${state.id} to ${roomId}`, e);
                    throw e;
                }
            }
        }
    }

    public async SetRoomState(member: GuildMember, roomId: string) {
        const state = await this.GetUserStateForGuildMember(member);
        log.info(`Setting room state for ${state.id} in ${roomId}`);
        await this.ApplyStateToRoom(state, roomId, member.guild.id);
    }

    public async ApplyStateToRoom(memberState: IGuildMemberState, roomId: string, guildId?: string) {
        log.info(`Applying new room state for ${memberState.mxUserId} to ${roomId}`);
        if (!memberState.displayName) {
            // Nothing to do. Quitting
            return;
        }
        const remoteUser = await this.userStore.getRemoteUser(memberState.id);
        let avatar = "";
        if (remoteUser) {
            avatar = remoteUser.avatarurlMxc || "";
        } else {
            log.warn("Remote user wasn't found, using blank avatar");
        }
        const intent = this.bridge.getIntent(memberState.mxUserId);
        /* The intent class tries to be smart and deny a state update for <PL50 users.
           Obviously a user can change their own state so we use the client instead. */
        await intent.getClient().sendStateEvent(roomId, "m.room.member", {
            "avatar_url": avatar,
            "displayname": memberState.displayName,
            "membership": "join",
            "uk.half-shot.discord.member": {
                bot: memberState.bot,
                displayColor: memberState.displayColor,
                id: memberState.id,
                roles: memberState.roles,
                username: memberState.username,
            },
        }, memberState.mxUserId);

        if (remoteUser) {
            if (guildId) {
                remoteUser.guildNicks.set(guildId, memberState.displayName);
            }
            await this.userStore.setRemoteUser(remoteUser);
        }
    }

    public async GetUserUpdateState(discordUser: User, webhookID?: string): Promise<IUserState> {
        log.verbose(`State update requested for ${discordUser.id}`);
        let mxidExtra = "";
        if (webhookID) {
            // no need to escape as this mxid is only used to create an intent
            mxidExtra = `_${new MatrixUser(`@${webhookID}`).localpart}`;
        }
        const userState: IUserState = Object.assign({}, DEFAULT_USER_STATE, {
            id: discordUser.id,
            mxUserId: `@_discord_${discordUser.id}${mxidExtra}:${this.config.bridge.domain}`,
        });
        const displayName = Util.ApplyPatternString(this.config.ghosts.usernamePattern, {
            id: discordUser.id,
            tag: discordUser.discriminator,
            username: discordUser.username,
        });
        // Determine if the user exists.
        const remoteId = discordUser.id + mxidExtra;
        const remoteUser = await this.userStore.getRemoteUser(remoteId);
        if (remoteUser === null) {
            log.verbose(`Could not find user in remote user store.`);
            userState.createUser = true;
            userState.displayName = displayName;
            userState.avatarUrl = discordUser.avatarURL;
            userState.avatarId = discordUser.avatar;
            return userState;
        }

        const oldDisplayName = remoteUser.displayname;
        if (oldDisplayName !== displayName) {
            log.verbose(`User ${discordUser.id} displayname should be updated`);
            userState.displayName = displayName;
        }

        const oldAvatarUrl = remoteUser.avatarurl;
        if (oldAvatarUrl !== discordUser.avatarURL) {
            log.verbose(`User ${discordUser.id} avatarurl should be updated`);
            if (discordUser.avatarURL !== null) {
                userState.avatarUrl = discordUser.avatarURL;
                userState.avatarId = discordUser.avatar;
            } else {
                userState.removeAvatar = oldAvatarUrl !== null;
            }
        }

        return userState;
    }

    public async GetUserStateForGuildMember(
        newMember: GuildMember,
    ): Promise<IGuildMemberState> {
        const name = Util.ApplyPatternString(this.config.ghosts.nickPattern, {
            id: newMember.user.id,
            nick: newMember.displayName,
            tag: newMember.user.discriminator,
            username: newMember.user.username,
        });
        const guildState: IGuildMemberState = Object.assign({}, DEFAULT_GUILD_STATE, {
            bot: newMember.user.bot,
            displayColor: newMember.displayColor,
            displayName: name,
            id: newMember.id,
            mxUserId: `@_discord_${newMember.id}:${this.config.bridge.domain}`,
            roles: newMember.roles.map((role) => { return {
                color: role.color,
                name: role.name,
                position: role.position,
            }; }),
            username: newMember.user.tag,
        });
        return guildState;
    }

    public async GetUserStateForDiscordUser(
        user: User,
        webhookID?: string,
    ): Promise<IGuildMemberState> {
        let mxidExtra = "";
        if (webhookID) {
            // no need to escape as this mxid is only used to create an Intent
            mxidExtra = `_${new MatrixUser(`@${user.username}`).localpart}`;
        }
        const guildState: IGuildMemberState = Object.assign({}, DEFAULT_GUILD_STATE, {
            bot: user.bot,
            displayName: user.username,
            id: user.id,
            mxUserId: `@_discord_${user.id}${mxidExtra}:${this.config.bridge.domain}`,
            roles: [],
            username: user.tag,
        });
        return guildState;
    }

    public async OnAddGuildMember(member: GuildMember) {
        log.info(`Joining ${member.id} to all rooms for guild ${member.guild.id}`);
        await this.OnUpdateGuildMember(member, true, false);
    }

    public async OnRemoveGuildMember(member: GuildMember) {
        /* NOTE: This can be because of a kick, ban or the user just leaving. Discord doesn't tell us. */
        log.info(`Leaving ${member.id} to all rooms for guild ${member.guild.id}`);
        const rooms = await this.discord.GetRoomIdsFromGuild(member.guild, undefined, false);
        const intent = this.discord.GetIntentFromDiscordMember(member);
        return Promise.all(
            rooms.map(
                async (roomId) => this.leave(intent, roomId, false),
            ),
        );
    }

    public async OnUpdateGuildMember(member: GuildMember, doJoin: boolean = false, useCache: boolean = true) {
        log.info(`Got update for ${member.id} (${member.user.username}).`);
        const state = await this.GetUserStateForGuildMember(member);
        let wantRooms: string[] = [];
        try {
            wantRooms = await this.discord.GetRoomIdsFromGuild(member.guild, member, useCache);
        } catch (err) { } // no want rooms
        let allRooms: string[] = [];
        try {
            allRooms = await this.discord.GetRoomIdsFromGuild(member.guild, undefined, useCache);
        } catch (err) { } // no all rooms

        const leaveRooms: string[] = [];
        await Util.AsyncForEach(allRooms, async (r) => {
            if (wantRooms.includes(r)) {
                return;
            }
            leaveRooms.push(r);
        });

        await Promise.all(
            wantRooms.map(
                async (roomId) => {
                    try {
                        if (doJoin) {
                            await this.JoinRoom(member, roomId);
                        } else {
                            await this.ApplyStateToRoom(state, roomId, member.guild.id);
                        }
                    } catch (err) {
                        log.error(`Failed to update ${member.id} (${member.user.username}) in ${roomId}`, err);
                    }
                },
            ),
        );
        const userId = state.mxUserId;
        const intent = this.bridge.getIntent(userId);
        await Promise.all(
            leaveRooms.map(
                async (roomId) => {
                    try {
                        await this.leave(intent, roomId, true);
                    } catch (e) { } // not in room
                },
            ),
        );
    }

    public async UpdateStateForGuilds(remoteUser: RemoteUser) {
        const id = remoteUser.id;
        log.info(`Got update for ${id}.`);

        await Util.AsyncForEach(this.discord.GetGuilds(), async (guild) => {
            if (guild.members.has(id)) {
                log.info(`Updating user ${id} in guild ${guild.id}.`);
                const member = guild.members.get(id);
                try {
                    const state = await this.GetUserStateForGuildMember(member!);
                    const rooms = await this.discord.GetRoomIdsFromGuild(guild, member!);
                    await Promise.all(
                        rooms.map(
                            async (roomId) => this.ApplyStateToRoom(state, roomId, guild.id),
                        ),
                    );
                } catch (err) {
                    log.warn(`Failed to update user ${id} in guild ${guild.id}`, err);
                }
            }
        });
    }

    private async leave(intent: Intent, roomId: string, checkCache: boolean = true) {
        const userId = intent.getClient().getUserId();
        if (checkCache && ![null, "join", "invite"]
            .includes(intent.opts.backingStore.getMembership(roomId, userId))) {
            return;
        }
        await intent.leave(roomId);
        intent.opts.backingStore.setMembership(roomId, userId, "leave");
    }
}
