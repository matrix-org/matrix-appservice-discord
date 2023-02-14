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

import { DiscordStore } from "../store";
import { ISqlCommandParameters } from "./connector";
import { IDbDataMany } from "./dbdatainterface";

export class DbReaction implements IDbDataMany {
    public MatrixId: string;
    public DiscordId: string;
    public GuildId: string;
    public ChannelId: string;
    public Result: boolean;
    public Emoji: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private rows: any[];

    get ResultCount(): number {
        return this.rows.length;
    }

    public async RunQuery(store: DiscordStore, params: ISqlCommandParameters): Promise<void> {
        this.rows = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let rowsM: any[] | null = null;
        if (params.matrix_id && params.emoji) {
            rowsM = await store.db.All(`
                SELECT *
                FROM reaction_store
                WHERE matrix_id = $id AND emoji = $emoji`, {
                id: params.matrix_id,
                emoji: params.emoji,
            });
        } else if (params.matrix_id) {
            rowsM = await store.db.All(`
                SELECT *
                FROM reaction_store
                WHERE matrix_id = $id`, {
                id: params.matrix_id
            });
        } else if (params.discord_id) {
            rowsM = await store.db.All(`
                SELECT *
                FROM reaction_store
                WHERE discord_id = $id`, {
                id: params.discord_id,
            });
        } else {
            throw new Error("Unknown/incorrect id given as a param");
        }

        for (const rowM of rowsM) {
            const row = {
                /* eslint-disable @typescript-eslint/naming-convention */
                discord_id: rowM.discord_id,
                matrix_id: rowM.matrix_id,
                emoji: rowM.emoji,
                /* eslint-enable @typescript-eslint/naming-convention */
            };
            for (const rowD of await store.db.All(`
                    SELECT *
                    FROM discord_msg_store
                    WHERE msg_id = $id`, {
                id: rowM.discord_id,
            })) {
                this.rows.push({
                    /* eslint-disable @typescript-eslint/naming-convention */
                    ...row,
                    guild_id: rowD.guild_id,
                    channel_id: rowD.channel_id,
                    /* eslint-enable @typescript-eslint/naming-convention */
                });
            }
        }
        this.Result = this.rows.length !== 0;
    }

    public Next(): boolean {
        if (!this.Result || this.ResultCount === 0) {
            return false;
        }
        const item = this.rows.shift();
        this.MatrixId = item.matrix_id;
        this.DiscordId = item.discord_id;
        this.Emoji = item.emoji;
        this.GuildId = item.guild_id;
        this.ChannelId = item.channel_id;
        return true;
    }

    public async Insert(store: DiscordStore): Promise<void> {
        await store.db.Run(`
            INSERT INTO reaction_store
			(matrix_id,discord_id,emoji)
			VALUES ($matrix_id,$discord_id,$emoji);`, {
            /* eslint-disable @typescript-eslint/naming-convention */
            discord_id: this.DiscordId,
            matrix_id: this.MatrixId,
            emoji: this.Emoji,
            /* eslint-enable @typescript-eslint/naming-convention */
        });
        // Check if the discord item exists?
        const msgExists = await store.db.Get(`
                SELECT *
                FROM discord_msg_store
                WHERE msg_id = $id`, {
            id: this.DiscordId,
        }) != null;
        if (msgExists) {
            return;
        }
        return store.db.Run(`
            INSERT INTO discord_msg_store
            (msg_id, guild_id, channel_id)
            VALUES ($msg_id, $guild_id, $channel_id);`, {
            /* eslint-disable @typescript-eslint/naming-convention */
            channel_id: this.ChannelId,
            guild_id: this.GuildId,
            msg_id: this.DiscordId,
            /* eslint-enable @typescript-eslint/naming-convention */
        });
    }

    public async Update(store: DiscordStore): Promise<void> {
        throw new Error("Update is not implemented");
    }

    public async Delete(store: DiscordStore): Promise<void> {
        await store.db.Run(`
            DELETE FROM reaction_store
            WHERE matrix_id = $matrix_id
            AND discord_id = $discord_id;`, {
            /* eslint-disable @typescript-eslint/naming-convention */
            discord_id: this.DiscordId,
            matrix_id: this.MatrixId,
            /* eslint-enable @typescript-eslint/naming-convention */
        });
        return store.db.Run(`
            DELETE FROM discord_msg_store
            WHERE msg_id = $discord_id;`, {
            /* eslint-disable @typescript-eslint/naming-convention */
            discord_id: this.DiscordId,
            /* eslint-enable @typescript-eslint/naming-convention */
        });
    }
}
