import {IDbSchema} from "./dbschema";
import {DiscordStore} from "../../store";

export class Schema implements IDbSchema {
    public description = "create event_store table";
    public async run(store: DiscordStore): Promise<void> {
        await store.create_table(`
            CREATE TABLE event_store (
                matrix_id TEXT NOT NULL,
                discord_id TEXT NOT NULL,
                PRIMARY KEY(matrix_id, discord_id)
        );`, "event_store");
    }

    public async rollBack(store: DiscordStore): Promise<void> {
        await store.db.Run(
            `DROP TABLE IF EXISTS event_store;`,
        );
    }
}
