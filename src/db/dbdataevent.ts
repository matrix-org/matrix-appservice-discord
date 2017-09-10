import { DiscordStore } from "../store";
import { IDbData, IDbDataMany } from "./dbdatainterface";
import * as log from "npmlog";

export class DbEvent implements IDbDataMany {
    public MatrixId: string;
    public DiscordId: string;
    public GuildId: string;
    public ChannelId: string;
    public Result: boolean;
    private rows: any[];

    get ResultCount(): number {
        return this.rows.length;
    }

    public async RunQuery(store: DiscordStore, params: any): Promise<null> {
        this.rows = [];
        let rowsM = null;
        if (params.matrix_id) {
            rowsM = await store.db.allAsync(`
                SELECT *
                FROM event_store
                WHERE matrix_id = $id`, {
                    $id: params.matrix_id,
            });
        } else if (params.discord_id) {
            rowsM = await store.db.allAsync(`
                SELECT *
                FROM event_store
                WHERE discord_id = $id`, {
                    $id: params.discord_id,
            });
        } else {
            throw new Error("Unknown/incorrect id given as a param");
        }

        for (const rowM of rowsM) {
            const row = {
                matrix_id: rowM.matrix_id,
                discord_id: rowM.discord_id,
            };
            for (const rowD of await store.db.allAsync(`
                    SELECT *
                    FROM discord_msg_store
                    WHERE msg_id = $id`, {
                        $id: rowM.discord_id,
            })) {
                const insertRow: any = Object.assign({}, row);
                insertRow.guild_id = rowD.guild_id;
                insertRow.channel_id = rowD.channel_id;
                this.rows.push(insertRow);
            }
        }
        this.Result = this.rows.length !== 0;
        return null;
    }

    public Next(): boolean {
        if (!this.Result || this.ResultCount === 0) {
            return false;
        }
        const item = this.rows.shift();
        this.MatrixId = item.matrix_id;
        this.DiscordId = item.discord_id;
        this.GuildId = item.guild_id;
        this.ChannelId = item.channel_id;
    }

    public async Insert(store: DiscordStore): Promise<null> {
        await store.db.runAsync(`
            INSERT INTO event_store
            (matrix_id,discord_id)
            VALUES ($matrix_id,$discord_id);`, {
                $matrix_id: this.MatrixId,
                $discord_id: this.DiscordId,
        });
        // Check if the discord item exists?
        const msgExists = await store.db.getAsync(`
                SELECT *
                FROM discord_msg_store
                WHERE msg_id = $id`, {
                    $id: this.DiscordId,
        }) !== undefined;
        if (msgExists) {
            return;
        }
        return store.db.runAsync(`
            INSERT INTO discord_msg_store
            (msg_id, guild_id, channel_id)
            VALUES ($msg_id, $guild_id, $channel_id);`, {
                $msg_id: this.DiscordId,
                $guild_id: this.GuildId,
                $channel_id: this.ChannelId,
        });
    }

    public Update(store: DiscordStore): Promise<null> {
        throw new Error("Update is not implemented");
    }

    public async Delete(store: DiscordStore): Promise<null> {
        await store.db.runAsync(`
            DELETE FROM event_store
            WHERE matrix_id = $matrix_id
            AND discord_id = $discord_id;`, {
                $matrix_id: this.MatrixId,
                $discord_id: this.DiscordId,
        });
        return store.db.runAsync(`
            DELETE FROM discord_msg_store
            WHERE msg_id = $discord_id;`, {
                $discord_id: this.DiscordId,
        });
    }
}
