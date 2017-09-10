import { DiscordStore } from "../store";
import { IDbData } from "./dbdatainterface";
import * as log from "npmlog";

export class DbEvent implements IDbData {
    public MatrixId: string;
    public DiscordId: string;
    public GuildId: string;
    public ChannelId: string;
    public Result: boolean;

    public async RunQuery(store: DiscordStore, params: any): Promise<null> {
        log.silly("DiscordStore", "_get_schema_version");
        let rowM = null;
        if (params.matrix_id) {
            rowM = await store.db.getAsync(`
                SELECT *
                FROM event_store
                WHERE matrix_id = $id`, {
                    $id: params.matrix_id,
            });
        } else if (params.discord_id) {
            rowM = await store.db.getAsync(`
                SELECT *
                FROM event_store
                WHERE discord_id = $id`, {
                    $id: params.discord_id,
            });
        } else {
            throw new Error("Unknown/incorrect id given as a param");
        }
        this.Result = rowM !== undefined;
        if (this.Result) {
            this.MatrixId = rowM.matrix_id;
            this.DiscordId = rowM.discord_id;
            const rowD = await store.db.getAsync(`
                SELECT *
                FROM discord_msg_store
                WHERE msg_id = $id`, {
                    $id: rowM.discord_id,
            });
            if (rowD !== undefined) {
                this.GuildId = rowD.guild_id;
                this.ChannelId = rowD.guild_id;
            } else {
                this.Result = false;
                throw new Error("Could not find discord event data in discord_msg_store");
            }
        }
        return null;
    }

    public async Insert(store: DiscordStore): Promise<null> {
        await store.db.runAsync(`
            INSERT INTO event_store
            (matrix_id,discord_id)
            VALUES ($matrix_id,$discord_id);`, {
                $matrix_id: this.MatrixId,
                $discord_id: this.DiscordId,
        });
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
