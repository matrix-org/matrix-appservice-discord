import { DiscordStore } from "../store";
import { IDbData } from "./dbdatainterface";
import * as log from "npmlog";

export class DbEvent implements IDbData {
    public MatrixId: string;
    public DiscordId: string;
    public Result: boolean;

    public async RunQuery(store: DiscordStore, params: any): Promise<null> {
        log.silly("DiscordStore", "_get_schema_version");
        let row = null;
        if (params.matrix_id) {
            row = await store.db.getAsync(`
                SELECT *
                FROM event_store
                WHERE matrix_id = $id`, {
                    $id: params.matrix_id,
            });
        } else if (params.discord_id) {
            row = await store.db.getAsync(`
                SELECT *
                FROM event_store
                WHERE discord_id = $id`, {
                    $id: params.discord_id,
            });
        } else {
            throw new Error("Unknown row given as a param");
        }
        this.Result = row !== undefined;
        if (this.Result) {
            this.MatrixId = row.matrix_id;
            this.DiscordId = row.discord_id;
        }
        return null;
    }

    public Insert(store: DiscordStore): Promise<null> {
        return store.db.runAsync(`
            INSERT INTO event_store
            (matrix_id,discord_id)
            VALUES ($matrix_id,$discord_id);`, {
                $matrix_id: this.MatrixId,
                $discord_id: this.DiscordId,
        });
    }

    public Update(store: DiscordStore): Promise<null> {
        throw new Error("Update is not implemented");
    }

    public Delete(store: DiscordStore): Promise<null> {
        return store.db.runAsync(`
            DELETE FROM event_store
            WHERE matrix_id = $matrix_id
            AND discord_id = $discord_id;`, {
                $matrix_id: this.MatrixId,
                $discord_id: this.DiscordId,
        });
    }
}
