/*
Copyright 2018 matrix-appservice-discord

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

const log = new Log("SchemaV7");

export class Schema implements IDbSchema {
    public description = "create guild emoji table";
    public async run(store: DiscordStore): Promise<void> {
        await store.createTable(`
            CREATE TABLE emoji (
                emoji_id TEXT NOT NULL,
                name TEXT NOT NULL,
                animated INTEGER NOT NULL,
                mxc_url TEXT NOT NULL,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL,
                PRIMARY KEY(emoji_id)
        );`, "emoji");

        // migrate existing emoji
        try {
            await store.db.Run(`
                INSERT INTO emoji
                (emoji_id, name, animated, mxc_url, created_at, updated_at)
                SELECT emoji_id, name, 0 AS animated, mxc_url, created_at, updated_at FROM guild_emoji;
                `);
        } catch (e) {
            // ignore errors
            log.warning("Failed to migrate old data to new table");
        }
    }

    public async rollBack(store: DiscordStore): Promise<void> {
        await store.db.Run(
            `DROP TABLE IF EXISTS emoji;`,
        );
    }
}
