/*
Copyright 2021 matrix-appservice-discord

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

const log = new Log("SchemaV12");

export class Schema implements IDbSchema {
    public description = "create stores for user activity tracking";

    public async run(store: DiscordStore): Promise<void> {
        try {
            await store.createTable(
                "CREATE TABLE user_activity (user_id TEXT UNIQUE, data JSON);",
                "user_activity",
            );
        } catch (ex) {
            log.error("Failed to create table:", ex);
        }

    }

    public async rollBack(store: DiscordStore): Promise<void> {
        await store.db.Exec(
            "DROP TABLE IF EXISTS user_activity;"
        );
    }
}
