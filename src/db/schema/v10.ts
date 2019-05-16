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

const log = new Log("SchemaV10");

export class Schema implements IDbSchema {
    public description = "create indexes on tables";
    private readonly INDEXES = {
        idx_discord_msg_store_msgid: ["discord_msg_store", "msg_id"],
        idx_emoji_id: ["emoji", "emoji_id"],
        idx_emoji_mxc_url: ["emoji", "mxc_url"],
        idx_event_store_discord_id: ["event_store", "discord_id"],
        idx_event_store_matrix_id: ["event_store", "matrix_id"],
        idx_remote_room_data_room_id: ["remote_room_data", "room_id"],
        idx_room_entries_id: ["room_entries", "id"],
        idx_room_entries_matrix_id: ["room_entries", "matrix_id"],
        idx_room_entries_remote_id: ["room_entries", "remote_id"],
    };

    public async run(store: DiscordStore): Promise<void> {
        try {
            await Promise.all(Object.keys(this.INDEXES).map(async (indexId: string) => {
                const ids = this.INDEXES[indexId];
                return store.db.Exec(`CREATE INDEX ${indexId} ON ${ids[0]}(${ids[1]})`);
            }));
        } catch (ex) {
            log.error("Failed to apply indexes:", ex);
        }

    }

    public async rollBack(store: DiscordStore): Promise<void> {
        await Promise.all(Object.keys(this.INDEXES).map(async (indexId: string) => {
            return store.db.Exec(`DROP INDEX ${indexId}`);
        }));
    }
}
