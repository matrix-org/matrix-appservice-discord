/*
Copyright 2017 - 2019 matrix-appservice-discord

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

import { DiscordStore } from "../store";
import { IDbData } from "./dbdatainterface";
import { ISqlCommandParameters } from "./connector";

interface IGuildBansParams extends ISqlCommandParameters {
    guild: string;
    channel: string|null;
}

export class DbGuildBans implements IDbData {
    public Guild: string;
    public Channel: string|null;
    public CreatedAt: number;
    public UpdatedAt: number;
    public Result: boolean;

    public get isGuildBanned() {
        return this.Channel === null;
    }

    public async RunQuery(store: DiscordStore, params: IGuildBansParams): Promise<void> {
        const query = `
            SELECT *
            FROM guild_bans
            WHERE guild_id = $id AND channel_id = $channel`;
        let row = await store.db.Get(query, {guild: params.guild, channel: null});
        this.Result = Boolean(row); // check if row exists
        if (this.Result && row) {
            this.Guild = row.guild_id as string;
            this.Channel = null;
            this.CreatedAt = row.created_at as number;
            this.UpdatedAt = row.updated_at as number;
            return;
        }
        row = await store.db.Get(query, {guild: params.guild, channel: params.channel});
        this.Result = Boolean(row); // check if row exists
        if (this.Result && row) {
            this.Guild = row.guild_id as string;
            this.Channel = row.channel_id as string;
            this.CreatedAt = row.created_at as number;
            this.UpdatedAt = row.updated_at as number;
        }
    }

    public async Insert(store: DiscordStore): Promise<void> {
        this.CreatedAt = new Date().getTime();
        this.UpdatedAt = this.CreatedAt;
        await store.db.Run(`
            INSERT INTO guild_bans
            (guild_id,channel_id,created_at,updated_at)
            VALUES ($guild_id,$channel_id,$created_at,$updated_at);`, {
                channel_id: this.Channel,
                created_at: this.CreatedAt,
                guild_id: this.Guild,
                updated_at: this.UpdatedAt,
        });
    }

    public async Update(): Promise<void> {
        throw new Error("Update is not implemented");
    }

    public async Delete(store: DiscordStore): Promise<void> {
        const query = `
            DELETE
            FROM guild_bans
            WHERE guild_id = $id AND channel_id = $channel`;
        await store.db.Run(query, {
            channel_id: this.Channel,
            guild_id: this.Guild,
        });
    }
}
