import {User, GuildMember, GuildChannel} from "discord.js";
import * as log from "npmlog";
import { DiscordBot } from "./bot";
import {Util} from "./util";
import { MatrixUser, RemoteUser, Bridge, Entry, UserBridgeStore } from "matrix-appservice-bridge";
import {DiscordBridgeConfig} from "./config";
import * as Bluebird from "bluebird";

const DEFAULT_USER_STATE = {
    id: null,
    createUser: false,
    mxUserId: null,
    displayName: null, // Nullable
    avatarUrl: null, // Nullable
    avatarId: null,
    removeAvatar: false,
};

const DEFAULT_GUILD_STATE = {
    id: null,
    mxUserId: null,
    displayName: null,
};

export interface IUserState {
    id: string;
    createUser: boolean;
    mxUserId: string;
    displayName: string; // Nullable
    avatarUrl: string; // Nullable
    avatarId: string;
    removeAvatar: boolean; // If the avatar has been removed from the user.
};

export interface IGuildMemberState {
    id: string;
    mxUserId: string;
    displayName: string;
}

/**
 * Class that syncronises Discord users with their bridge ghost counterparts.
 * Also handles member events that may occur when using guild nicknames.
 */
export class UserSyncroniser {

    public static readonly ERR_USER_NOT_FOUND = "user_not_found";
    public static readonly ERR_CHANNEL_MEMBER_NOT_FOUND = "channel_or_member_not_found";
    public static readonly ERR_NEWER_EVENT = "newer_state_event_arrived";

    // roomId+userId => ev
    public userStateHold: Map<string, any>;
    private userStore: UserBridgeStore;
    constructor(
        private bridge: Bridge,
        private config: DiscordBridgeConfig,
        private discord: DiscordBot) {
        this.userStore = this.bridge.getUserStore();
        this.userStateHold = new Map<string, any>();
    }

    /**
     * Should be called when the discord user is updated.
     * @param {module:discord.js.User} Old user object. If not used, new user object.
     * @param {module:discord.js.User} New user object
     * @returns {Promise<void>}
     * @constructor
     */
    public async OnUpdateUser(discordUser: User) {
        const userState = await this.GetUserUpdateState(discordUser);
        try {
            await this.ApplyStateToProfile(userState);
        } catch (e) {
            log.error("UserSync", "Failed to update user's profile", e);
        }
    }

    public async ApplyStateToProfile(userState: IUserState) {
        const intent = this.bridge.getIntent(userState.mxUserId);
        let userUpdated = false;
        let remoteUser = null;
        if (userState.createUser) {
            /* NOTE: Setting the displayname/avatar will register the user if they don't exist */
            log.info("UserSync", `Creating new user ${userState.mxUserId}`);
            remoteUser = new RemoteUser(userState.id);
            await this.userStore.linkUsers(
                new MatrixUser(userState.mxUserId.substr("@".length)),
                remoteUser,
            );

        } else {
            remoteUser = await this.userStore.getRemoteUser(userState.id);
        }

        if (userState.displayName !== null) {
            log.verbose("UserSync", `Updating displayname for ${userState.mxUserId} to "${userState.displayName}"`);
            await intent.setDisplayName(userState.displayName);
            remoteUser.set("displayname", userState.displayName);
            userUpdated = true;
        }

        if (userState.avatarUrl !== null) {
            log.verbose("UserSync", `Updating avatar_url for ${userState.mxUserId} to "${userState.avatarUrl}"`);
            const avatarMxc = await Util.UploadContentFromUrl(
                userState.avatarUrl,
                intent,
                userState.avatarId,
            );
            await intent.setAvatarUrl(avatarMxc.mxcUrl);
            remoteUser.set("avatarurl", userState.avatarUrl);
            remoteUser.set("avatarurl_mxc", avatarMxc.mxcUrl);
            userUpdated = true;
        }

        if (userState.removeAvatar) {
            log.verbose("UserSync", `Clearing avatar_url for ${userState.mxUserId} to "${userState.avatarUrl}"`);
            await intent.setAvatarUrl(null);
            remoteUser.set("avatarurl", null);
            remoteUser.set("avatarurl_mxc", null);
            userUpdated = true;
        }

        if (userUpdated) {
            await this.userStore.setRemoteUser(remoteUser);
            await this.UpdateStateForGuilds(remoteUser);
        }
    }

    public async EnsureJoin(member: GuildMember, roomId: string) {
        const mxUserId = `@_discord_${member.id}:${this.config.bridge.domain}`;
        log.info("UserSync", `Ensuring ${mxUserId} is joined to ${roomId}`);
        const state = <IGuildMemberState> {
            id: member.id,
            mxUserId,
            displayName: member.displayName,
        };
        await this.ApplyStateToRoom(state, roomId, member.guild.id);
    }

    public async ApplyStateToRoom(memberState: IGuildMemberState, roomId: string, guildId: string) {
        log.info("UserSync", `Applying new room state for ${memberState.mxUserId} to ${roomId}`);
        if (memberState.displayName === null) {
            // Nothing to do. Quitting
            return;
        }
        const nickKey = `nick_${guildId}`;
        const remoteUser = await this.userStore.getRemoteUser(memberState.id);
        const intent = this.bridge.getIntent(memberState.mxUserId);
        /* The intent class tries to be smart and deny a state update for <PL50 users.
           Obviously a user can change their own state so we use the client instead. */
        const tryState = () => intent.getClient().sendStateEvent(roomId, "m.room.member", {
            membership: "join",
            avatar_url: remoteUser.get("avatarurl_mxc"),
            displayname: memberState.displayName,
        }, memberState.mxUserId);
        try {
            await tryState();
        } catch (e) {
            if (e.errorcode !== "M_FORBIDDEN") {
                log.warn("UserSync", `Failed to send state to ${roomId}`, e);
            } else {
                log.warn("UserSync", `User not in room ${roomId}, inviting`);
                try {
                    await this.bridge.getIntent().invite(roomId, memberState.mxUserId);
                    await tryState();
                } catch (e) {
                    log.warn("UserSync", `Failed to send state to ${roomId}`, e);
                }
            }
        }

        remoteUser.set(nickKey, memberState.displayName);
        return this.userStore.setRemoteUser(remoteUser);
    }

    public async GetUserUpdateState(discordUser: User): Promise<IUserState> {
        log.verbose("UserSync", `State update requested for ${discordUser.id}`);
        const userState = Object.assign({}, DEFAULT_USER_STATE, {
            id: discordUser.id,
            mxUserId: `@_discord_${discordUser.id}:${this.config.bridge.domain}`,
        });
        const displayName = this.displayNameForUser(discordUser);
        // Determine if the user exists.
        const remoteUser = await this.userStore.getRemoteUser(discordUser.id);
        if (remoteUser === null) {
            log.verbose("UserSync", `Could not find user in remote user store.`);
            userState.createUser = true;
            userState.displayName = displayName;
            userState.avatarUrl = discordUser.avatarURL;
            userState.avatarId = discordUser.avatar;
            return userState;
        }

        const oldDisplayName = remoteUser.get("displayname");
        if (oldDisplayName !== displayName) {
            log.verbose("UserSync", `User ${discordUser.id} displayname should be updated`);
            userState.displayName = displayName;
        }

        const oldAvatarUrl = remoteUser.get("avatarurl");
        if (oldAvatarUrl !== discordUser.avatarURL) {
            log.verbose("UserSync", `User ${discordUser.id} avatarurl should be updated`);
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
        displayname: string,
    ): Promise<IGuildMemberState> {
        const guildState = Object.assign({}, DEFAULT_GUILD_STATE, {
            id: newMember.id,
            mxUserId: `@_discord_${newMember.id}:${this.config.bridge.domain}`,
        });

        // Check guild nick.
        if (displayname !== newMember.displayName) {
            guildState.displayName = newMember.displayName;
        }
        return guildState;
    }

    public async OnAddGuildMember(member: GuildMember) {
        log.info("UserSync", `Joining ${member.id} to all rooms for guild ${member.guild.id}`);
        const rooms = await this.discord.GetRoomIdsFromGuild(member.guild.id);
        const intent = this.discord.GetIntentFromDiscordMember(member);
        await this.OnUpdateUser(member.user);
        return Promise.all(
            rooms.map(
                (roomId) => intent.join(roomId),
            ),
        );
    }

    public async OnRemoveGuildMember(member: GuildMember) {
        /* NOTE: This can be because of a kick, ban or the user just leaving. Discord doesn't tell us. */
        log.info("UserSync", `Leaving ${member.id} to all rooms for guild ${member.guild.id}`);
        const rooms = await this.discord.GetRoomIdsFromGuild(member.guild.id);
        const intent = this.discord.GetIntentFromDiscordMember(member);
        return Promise.all(
            rooms.map(
                (roomId) => intent.leave(roomId),
            ),
        );
    }

    public async OnUpdateGuildMember(oldMember: GuildMember, newMember: GuildMember) {
        log.info("UserSync", `Got update for ${oldMember.id}.`);
        const state = await this.GetUserStateForGuildMember(newMember, oldMember.displayName);
        const rooms = await this.discord.GetRoomIdsFromGuild(newMember.guild.id);
        return Promise.all(
            rooms.map(
                (roomId) => this.ApplyStateToRoom(state, roomId, newMember.guild.id),
            ),
        );
    }

    public async UpdateStateForGuilds(remoteUser: any) {
        const id = remoteUser.getId();
        log.info("UserSync", `Got update for ${id}.`);

        return this.discord.GetGuilds().map(async (guild) => {
            if (guild.members.has(id)) {
                log.info("UserSync", `Updating user ${id} in guild ${guild.id}.`);
                const member = guild.members.get(id);
                const state = await this.GetUserStateForGuildMember(member, remoteUser.get("displayname"));
                const rooms = await this.discord.GetRoomIdsFromGuild(guild.id);
                return Promise.all(
                    rooms.map(
                        (roomId) => this.ApplyStateToRoom(state, roomId, guild.id),
                    ),
                );
            }
        });
    }

    public async OnMemberState(ev: any, delayMs: number = 0): Promise<string> {
        // Avoid tripping over multiple state events.
        if (await this.memberStateLock(ev, delayMs) === false) {
            // We're igorning this update because we have a newer one.
            return UserSyncroniser.ERR_NEWER_EVENT;
        }
        log.verbose("UserSync", `m.room.member was updated for ${ev.state_key}, checking if nickname needs updating.`);
        const roomId = ev.room_id;
        let discordId;
        try {
            const remoteUsers = await this.userStore.getRemoteUsersFromMatrixId(ev.state_key);
            if (remoteUsers.length === 0) {
                throw Error("User not found");
            }
            discordId = remoteUsers[0].getId();
        } catch (e) {
            log.warn("UserSync", `Got member update for ${ev.state_key}, but no user is linked in the store`);
            return UserSyncroniser.ERR_USER_NOT_FOUND;
        }

        // Fetch guild member by roomId;
        let member;
        try {
            const channel = await this.discord.GetChannelFromRoomId(roomId) as GuildChannel;
            member = await channel.guild.fetchMember(discordId);
        } catch (e) {
            log.warn("UserSync", `Got member update for ${roomId}, but no channel or guild member could be found.`);
            return UserSyncroniser.ERR_CHANNEL_MEMBER_NOT_FOUND;
        }
        const state = await this.GetUserStateForGuildMember(member, ev.content.displayname);
        return this.ApplyStateToRoom(state, roomId, member.guild.id);
    }

    private async memberStateLock(ev: any, delayMs: number = -1): Promise<boolean> {
        const userStateKey = `${ev.room_id}${ev.state_key}`;
        if (this.userStateHold.has(userStateKey)) {
            const oldEv = this.userStateHold.get(userStateKey);
            if (ev.origin_server_ts > oldEv.origin_server_ts) {
                return false; // New event is older
            }
        }
        this.userStateHold.set(userStateKey, ev);
        // tslint:disable-next-line:await-promise
        await Bluebird.delay(delayMs);
        if (this.userStateHold.get(userStateKey).event_id !== ev.event_id) {
            // Event has changed and we are out of date.
            return false;
        }
        this.userStateHold.delete(userStateKey);
        return true;
    }

    private displayNameForUser(discordUser): string {
        return discordUser.username + "#" + discordUser.discriminator;
    }
}
