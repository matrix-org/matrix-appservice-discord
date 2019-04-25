import { IDatabaseConnector } from "./connector";
import * as uuid from "uuid/v4";
import { Log } from "../log";

/**
 * A UserStore compatible with
 * https://github.com/matrix-org/matrix-appservice-bridge/blob/master/lib/components/user-bridge-store.js
 * that accesses the database instead.
 */

const ENTRY_CACHE_LIMETIME = 30000;

export class RemoteUser {
    public displayname: string|null = null;
    public avatarurl: string|null = null;
    public avatarurlMxc: string|null = null;
    public guildNicks: Map<string, string> = new Map();
    constructor(public readonly id: string) {

    }
}

const log = new Log("DbUserStore");

export interface IUserStoreEntry {
    id: string;
    matrix: string|null;
    remote: RemoteUser|null;
}

export class DbUserStore {
    private remoteUserCache: Map<string, {e: RemoteUser, ts: number}>;

    constructor(private db: IDatabaseConnector) {
        this.remoteUserCache = new Map();
    }

    public async getRemoteUser(remoteId: string): Promise<RemoteUser|null> {
        const cached = this.remoteUserCache.get(remoteId);
        if (cached && cached.ts + ENTRY_CACHE_LIMETIME > Date.now()) {
            return cached.e;
        }
        const row = await this.db.Get(
            "SELECT * FROM user_entries WHERE remote_id = $id", {id: remoteId},
        );
        if (!row) {
            return null;
        }
        const remoteUser = new RemoteUser(remoteId);
        const data = await this.db.Get(
            "SELECT * FROM remote_user_data WHERE remote_id = $remoteId",
            {remoteId},
        );
        if (data) {
            remoteUser.avatarurl = data.avatarurl as string|null;
            remoteUser.displayname = data.displayname as string|null;
            remoteUser.avatarurlMxc = data.avatarurl_mxc as string|null;
        }
        const nicks = await this.db.All(
            "SELECT guild_id, nick FROM remote_user_guild_nicks WHERE remote_id = $remoteId",
            {remoteId},
        );
        if (nicks) {
            nicks.forEach(({nick, guild_id}) => {
                remoteUser.guildNicks.set(guild_id as string, nick as string);
            });
        }
        this.remoteUserCache.set(remoteId, {e: remoteUser, ts: Date.now()});
        return remoteUser;
    }

    public async setRemoteUser(user: RemoteUser) {
        this.remoteUserCache.delete(user.id);
        const existingData = await this.db.Get(
            "SELECT * FROM remote_user_data WHERE remote_id = $remoteId",
            {remoteId: user.id},
        );
        if (!existingData) {
            await this.db.Run(
            `INSERT INTO remote_user_data VALUES (
                $remote_id,
                $displayname,
                $avatarurl,
                $avatarurl_mxc
            )`,
            {
                avatarurl: user.avatarurl,
                avatarurl_mxc: user.avatarurlMxc,
                displayname: user.displayname,
                remote_id: user.id,
            });
        } else {
            await this.db.Run(
`UPDATE remote_user_data SET displayname = $displayname,
avatarurl = $avatarurl,
avatarurl_mxc = $avatarurl_mxc WHERE remote_id = $remote_id`,
            {
                avatarurl: user.avatarurl,
                avatarurl_mxc: user.avatarurlMxc,
                displayname: user.displayname,
                remote_id: user.id,
            });
        }
        const existingNicks = {};
        (await this.db.All(
            "SELECT guild_id, nick FROM remote_user_guild_nicks WHERE remote_id = $remoteId",
            {remoteId: user.id},
        )).forEach(({guild_id, nick}) => existingNicks[guild_id as string] = nick);
        for (const guildId of user.guildNicks.keys()) {
            const nick = user.guildNicks.get(guildId) || null;
            if (existingData) {
                if (existingNicks[guildId] === nick) {
                    return;
                } else if (existingNicks[guildId]) {
                    await this.db.Run(
`UPDATE remote_user_guild_nicks SET nick = $nick
WHERE remote_id = $remote_id
AND guild_id = $guild_id`,
                    {
                        guild_id: guildId,
                        nick,
                        remote_id: user.id,
                    });
                    return;
                }
            }
            await this.db.Run(
            `INSERT INTO remote_user_guild_nicks VALUES (
                $remote_id,
                $guild_id,
                $nick
            )`,
            {
                guild_id: guildId,
                nick,
                remote_id: user.id,
            });
        }

    }

    public async linkUsers(matrixId: string, remoteId: string) {
        // This is used  ONCE in the bridge to link two IDs, so do not UPSURT data.
        try {
            await this.db.Run(`INSERT INTO user_entries VALUES ($matrixId, $remoteId)`, {
                matrixId,
                remoteId,
            });
        } catch (ex) {
            log.verbose("Failed to insert into user_entries, entry probably exists:", ex);
        }
    }
}
