import {IDbSchema} from "./dbschema";
import {DiscordStore} from "../../store";

export class Schema implements IDbSchema {
    public description = "create event_store and discord_msg_store tables";
    public async run(store: DiscordStore): Promise<void> {
        await store.db.Run(
            `DROP TABLE IF EXISTS event_store;`,
        );
        await store.create_table(`
            CREATE TABLE event_store (
                matrix_id TEXT NOT NULL,
                discord_id TEXT NOT NULL,
                PRIMARY KEY(matrix_id, discord_id)
        );`, "event_store");
        await store.create_table(`
            CREATE TABLE discord_msg_store (
                msg_id TEXT NOT NULL,
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                PRIMARY KEY(msg_id)
        );`, "discord_msg_store");
    }

    public async rollBack(store: DiscordStore): Promise<void> {
        await store.db.Exec(
            `DROP TABLE IF EXISTS event_store;` +
            `DROP TABLE IF EXISTS discord_msg_store;`,
        );
    }
}
