/*
Copyright 2017, 2018 matrix-appservice-discord

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
export class Schema implements IDbSchema {
    public description = "Schema, Client Auth Table";
    public async run(store: DiscordStore): Promise<void> {
        await store.createTable(`
            CREATE TABLE schema (
                version	INTEGER UNIQUE NOT NULL
            );`, "schema");
        await store.db.Exec("INSERT INTO schema VALUES (0);");
        await store.createTable(`
            CREATE TABLE user_tokens (
                userId TEXT UNIQUE NOT NULL,
                token TEXT UNIQUE NOT NULL
            );`, "user_tokens");
    }
    public async rollBack(store: DiscordStore): Promise<void> {
        await store.db.Exec(
            `DROP TABLE IF EXISTS schema;
            DROP TABLE IF EXISTS user_tokens`,
        );
    }
}
