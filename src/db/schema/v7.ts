import {IDbSchema} from "./dbschema";
import {DiscordStore} from "../../store";
import { Log } from "../../log";

const log = new Log("SchemaV7");

export class Schema implements IDbSchema {
    public description = "create guild emoji table";
    public async run(store: DiscordStore): Promise<void> {
        await store.create_table(`
            CREATE TABLE emoji (
                emoji_id TEXT NOT NULL,
                name TEXT NOT NULL,
                animated INTEGER NOT NULL,
                mxc_url TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY(emoji_id)
        );`, "emoji");

        // migrate existing emoji
        try {
            await store.db.Run(`
                INSERT INTO emoji
                (emoji_id, name, animated, mxc_url, created_at, updated_at)
                SELECT emoji_id, name, 0 AS animated, mxc_url, created_at, updated_at FROM guild_emoji;
                `);
        } catch (e) {
            // ignore errors
            log.warning("Failed to migrate old data to new table");
        }
    }

    public async rollBack(store: DiscordStore): Promise<void> {
        await store.db.Run(
            `DROP TABLE IF EXISTS emoji;`,
        );
    }
}
