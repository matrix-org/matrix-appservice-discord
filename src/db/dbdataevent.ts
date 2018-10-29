import { DiscordStore } from "../store";
import { IDbDataMany } from "./dbdatainterface";

export class DbEvent implements IDbDataMany {
    public MatrixId: string;
    public DiscordId: string;
    public GuildId: string;
    public ChannelId: string;
    public Result: boolean;
    // tslint:disable-next-line no-any
    private rows: any[];

    get ResultCount(): number {
        return this.rows.length;
    }

    // tslint:disable-next-line no-any
    public async RunQuery(store: DiscordStore, params: any): Promise<void> {
        this.rows = [];
        let rowsM = null;
        if (params.matrix_id) {
            rowsM = await store.db.All(`
                SELECT *
                FROM event_store
                WHERE matrix_id = $id`, {
                    id: params.matrix_id,
            });
        } else if (params.discord_id) {
            rowsM = await store.db.All(`
                SELECT *
                FROM event_store
                WHERE discord_id = $id`, {
                    id: params.discord_id,
            });
        } else {
            throw new Error("Unknown/incorrect id given as a param");
        }

        for (const rowM of rowsM) {
            const row = {
                discord_id: rowM.discord_id,
                matrix_id: rowM.matrix_id,
            };
            for (const rowD of await store.db.All(`
                    SELECT *
                    FROM discord_msg_store
                    WHERE msg_id = $id`, {
                        id: rowM.discord_id,
            })) {
                // tslint:disable-next-line no-any
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
        return true;
    }

    public async Insert(store: DiscordStore): Promise<void> {
        await store.db.Run(`
            INSERT INTO event_store
            (matrix_id,discord_id)
            VALUES ($matrix_id,$discord_id);`, {
                discord_id: this.DiscordId,
                matrix_id: this.MatrixId,
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
                channel_id: this.ChannelId,
                guild_id: this.GuildId,
                msg_id: this.DiscordId,
        });
    }

    public async Update(store: DiscordStore): Promise<void> {
        throw new Error("Update is not implemented");
    }

    public async Delete(store: DiscordStore): Promise<void> {
        await store.db.Run(`
            DELETE FROM event_store
            WHERE matrix_id = $matrix_id
            AND discord_id = $discord_id;`, {
                discord_id: this.DiscordId,
                matrix_id: this.MatrixId,
        });
        return store.db.Run(`
            DELETE FROM discord_msg_store
            WHERE msg_id = $discord_id;`, {
                discord_id: this.DiscordId,
        });
    }
}
