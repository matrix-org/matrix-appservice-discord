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

import { IDbSchema } from "./dbschema";
import { DiscordStore } from "../../store";
import { Log } from "../../log";
import {
    UserStore,
} from "matrix-appservice-bridge";
import { RemoteUser } from "../userstore";
import PQueue from "p-queue";
const log = new Log("SchemaV9");

export class Schema implements IDbSchema {
    public description = "create user store tables";

    constructor(private userStore: UserStore|null) {

    }

    public async run(store: DiscordStore): Promise<void> {
        await store.createTable(`
            CREATE TABLE remote_user_guild_nicks (
                remote_id TEXT NOT NULL,
                guild_id TEXT NOT NULL,
                nick TEXT NOT NULL,
                PRIMARY KEY(remote_id, guild_id)
        );`, "remote_user_guild_nicks");

        await store.createTable(`
            CREATE TABLE remote_user_data (
                remote_id TEXT NOT NULL,
                displayname TEXT,
                avatarurl TEXT,
                avatarurl_mxc TEXT,
                PRIMARY KEY(remote_id)
        );`, "remote_user_data");

        await store.createTable(`
            CREATE TABLE user_entries (
                matrix_id TEXT,
                remote_id TEXT,
                PRIMARY KEY(matrix_id, remote_id)
        );`, "user_entries");

        if (this.userStore === null) {
            log.warn("Not migrating users from users store, users store is null");
            return;
        }
        log.warn("Migrating users from userstore, this may take a while...");
        const remoteUsers = await this.userStore.select({type: "remote"});
        log.info(`Found ${remoteUsers.length} remote users in the DB`);
        let migrated = 0;
        const processQueue = new PQueue({
            autoStart: true,
            concurrency: 100,
        });
        for (const user of remoteUsers) {
            const matrixIds = await this.userStore.getMatrixLinks(user.id);
            if (!matrixIds || matrixIds.length === 0) {
                log.warn(`Not migrating ${user.id}, has no linked matrix user`);
                continue;
            } else if (matrixIds.length > 1) {
                log.warn(`Multiple matrix ids for ${user.id}, using first`);
            }
            const matrixId = matrixIds[0];
            try {
                const remote = new RemoteUser(user.id);
                remote.avatarurl = user.data.avatarurl;
                remote.avatarurlMxc = user.data.avatarurl_mxc;
                remote.displayname = user.data.displayname;
                Object.keys(user.data).filter((k) => k.startsWith("nick_")).forEach((k) => {
                    remote.guildNicks.set(k.substr("nick_".length), user.data[k]);
                });
                processQueue.add(async () => {
                    await store.userStore.linkUsers(matrixId, remote.id);
                    return store.userStore.setRemoteUser(remote);
                }).then(() => {
                    log.info(`Migrated ${matrixId}, ${processQueue.pending} to go.`);
                    migrated++;
                }).catch((err) => {
                    log.error(`Failed to migrate ${matrixId} ${err}`);
                });
            } catch (ex) {
                log.error(`Failed to link ${matrixId}: `, ex);
            }
        }
        await processQueue.onIdle();
        if (migrated !== remoteUsers.length) {
            log.error(`Didn't migrate all users, ${remoteUsers.length - migrated} failed to be migrated.`);
        } else {
            log.info("Migrated all users successfully");
        }
    }

    public async rollBack(store: DiscordStore): Promise<void> {
        await store.db.Run(
            `DROP TABLE IF EXISTS remote_user_guild_nicks;`,
        );
        await store.db.Run(
            `DROP TABLE IF EXISTS remote_user_data;`,
        );
        await store.db.Run(
            `DROP TABLE IF EXISTS user_entries;`,
        );
    }
}
