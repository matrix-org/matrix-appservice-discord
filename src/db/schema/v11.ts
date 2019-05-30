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

import {IDbSchema} from "./dbschema";
import {DiscordStore} from "../../store";
import { Log } from "../../log";

const log = new Log("SchemaV11");

export class Schema implements IDbSchema {
    public readonly description = "create oauth_tokens";
    public async run(store: DiscordStore): Promise<void> {
        await store.createTable(`CREATE TABLE oauth_tokens (
            matrix_id TEXT NOT NULL,
            discord_id TEXT NOT NULL,
            access_token TEXT NOT NULL,
            refresh_token TEXT NOT NULL,
            expires_in INTEGER,
            created_at BIGINT,
            PRIMARY KEY(matrix_id, discord_id)
        );`, "oauth_tokens");
        await store.db.Exec("CREATE INDEX idx_oauth_tokens_mx ON oauth_tokens(matrix_id)");
        await store.db.Exec("CREATE INDEX idx_oauth_tokens_dc ON oauth_tokens(discord_id)");
    }

    public async rollBack(store: DiscordStore): Promise<void> {
        await store.db.Exec("DROP TABLE oauth_tokens");
    }
}
