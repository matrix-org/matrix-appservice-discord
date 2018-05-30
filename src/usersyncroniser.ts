import { User, GuildMember } from "discord.js";
import * as log from "npmlog";
import { DiscordBot } from "./bot";
import {Util} from "./util";
import { MatrixUser, RemoteUser, Bridge, Entry } from "matrix-appservice-bridge";
import {DiscordBridgeConfig} from "./config";

const DEFAULT_USER_STATE = {
    id: null,
    createUser: false,
    mxUserId: null,
    displayName: null, // Nullable
    avatarUrl: null, // Nullable
    avatarId: null,
    removeAvatar: false,
};

export interface IUserState {
    id: string;
    createUser: boolean;
    mxUserId: string;
    displayName: string; // Nullable
    avatarUrl: string; // Nullable
    avatarId: string;
    removeAvatar: boolean; // If the avatar has been removed from the user.
}

/**
 * Class that syncronises Discord users with their bridge ghost counterparts.
 * Also handles member events that may occur when using guild nicknames.
 */
export class UserSyncroniser {

    constructor(private bridge: Bridge, private config: DiscordBridgeConfig) { }

    public async OnUpdateUser(oldUser: User, newUser: User) {
        const userState: IUserState = await this.GetUserUpdateState(oldUser, newUser);
        this.ApplyUserState(userState);
    }

    public async ApplyUserState(userState: IUserState) {
        const intent = this.bridge.getIntent(userState.mxUserId);
        const userStore = this.bridge.getUserStore();
        let userUpdated = false;
        let remoteUser = null;
        if (userState.createUser) {
            log.info(`Creating new user ${userState.mxUserId}`);
            remoteUser = new RemoteUser(userState.id);
            await userStore.linkUsers(
                new MatrixUser(userState.mxUserId.substr("@".length)),
                remoteUser,
            );

        } else {
            remoteUser = await userStore.getRemoteUser(userState.id);
        }

        if (userState.displayName !== null) {
            log.verbose(`Updating displayname for ${userState.mxUserId} to "${userState.displayName}"`);
            await intent.setDisplayName(userState.displayName);
            remoteUser.set("displayname", userState.displayName);
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
            remoteUser.set("avatarurl", userState.avatarUrl);
            userUpdated = true;
        }

        if (userState.removeAvatar) {
            await intent.setAvatarUrl(null);
            remoteUser.set("avatarurl", null);
            userUpdated = true;
        }

        if (userUpdated) {
            userStore.setRemoteUser(remoteUser);
            // NOTE: We've updated the *main* profile, which means we need to redo nicknames.
        }
    }

    public async GetUserUpdateState(oldUser: User, newUser?: User): Promise<IUserState> {
        if (newUser === null) {
            newUser = oldUser;
        }
        log.verbose("UserSync", `State update requested for ${newUser.id}`);
        const userState = Object.assign({}, DEFAULT_USER_STATE);
        userState.id = newUser.id;
        const displayName = newUser.username + "#" + newUser.discriminator;
        userState.mxUserId = `@_discord_${newUser.id}:${this.config.bridge.domain}`;
        const userStore = this.bridge.getUserStore();
        // Determine if the user exists.
        const remoteUser = await userStore.getRemoteUser(newUser.id);

        if (remoteUser === null) {
            log.verbose("UserSync", `Could not find user in remote user store.`);
            userState.createUser = true;
            userState.displayName = displayName;
            userState.avatarUrl = newUser.avatarURL;
            userState.avatarId = "111";
            return userState;
        }

        const oldDisplayName = remoteUser.get("displayname");
        if (oldDisplayName !== displayName) {
            log.verbose("UserSync", `User ${newUser.id} displayname should be updated`);
            userState.displayName = displayName;
        }

        const oldAvatarUrl = remoteUser.get("avatarurl");
        if (oldAvatarUrl !== newUser.avatarURL) {
            log.verbose("UserSync", `User ${newUser.id} avatarurl should be updated`);
            if (newUser.avatarURL !== null) {
                userState.avatarUrl = newUser.avatarURL;
                userState.avatarId = newUser.avatar;
            } else {
                userState.removeAvatar = oldAvatarUrl !== null;
            }
        }

        return userState;
    }

    public OnAddGuildMember(member: GuildMember) {

    }

    public OnRemoveGuildMember(member: GuildMember) {

    }

    public OnUpdateGuildMember(oldMember: GuildMember, newMember: GuildMember = null) {
        if (newMember === null) {
            newMember = oldMember;
        }
    }
}
