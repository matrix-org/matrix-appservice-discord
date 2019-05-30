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
import { IDbDataMany } from "./dbdatainterface";
import { ISqlCommandParameters } from "./connector";

export class DbAccessToken implements IDbDataMany {
    public MatrixId: string;
    public DiscordId: string;
    public AccessToken: string;
    public RefreshToken: string;
    public ExpiresIn: number;
    public CreatedAt: number;

    public Result: boolean;
    // tslint:disable-next-line no-any
    private rows: any[];

    get ResultCount(): number {
        return this.rows.length;
    }

    public async RunQuery(store: DiscordStore, params: {matrix_id?: string, discord_id?: string}): Promise<void> {
        let query = `
            SELECT *
            FROM oauth_tokens`;
        let id: string;
        if (params.matrix_id) {
            query += "WHERE matrix_id = $id";
            id = params.matrix_id;
        } else if (params.discord_id) {
            query += "WHERE discord_id = $id";
            id = params.discord_id;
        } else {
            throw new Error("Must specify either matrix_id or discord_id");
        }
        const rows = await store.db.All(query, {
            id,
        });
        this.Result = rows.length > 0;
    }

    public async Insert(store: DiscordStore): Promise<void> {
        this.CreatedAt = new Date().getTime();
        await store.db.Run(`
            INSERT INTO oauth_tokens
            (matrix_id,discord_id,access_token,refresh_token,created_at,expires_in)
            VALUES ($matrix_id,$discord_id,$access_token,$refresh_token,$created_at,$expires_in);`, {
                access_token: this.AccessToken,
                created_at: this.CreatedAt,
                discord_id: this.DiscordId,
                expires_in: this.ExpiresIn,
                matrix_id: this.MatrixId,
                refresh_token: this.RefreshToken,
        });
    }

    public Next(): boolean {
        if (!this.Result || this.ResultCount === 0) {
            return false;
        }
        const item = this.rows.shift();
        this.MatrixId = item.matrix_id;
        this.DiscordId = item.discord_id;
        this.AccessToken = item.access_token;
        this.RefreshToken = item.refresh_token;
        this.ExpiresIn = item.expires_in;
        this.CreatedAt = item.created_at;
        return true;
    }

    public async Update(store: DiscordStore): Promise<void> {
        throw new Error("Delete is not implemented");
    }

    public async Delete(store: DiscordStore): Promise<void> {
        store.db.Run("DELETE FROM oauth_tokens WHERE discord_id = $id", {id: this.DiscordId});
    }
}
