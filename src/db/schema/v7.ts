import {IDbSchema} from "./dbschema";
import {DiscordStore} from "../../store";
import { Log } from "../../log";

const log = new Log("SchemaV7");

export class Schema implements IDbSchema {
    public description = "create guild emoji table";
    public run(store: DiscordStore): Promise<null> {
        return store.create_table(`
            CREATE TABLE emoji (
                emoji_id TEXT NOT NULL,
                name TEXT NOT NULL,
                animated INTEGER NOT NULL,
                mxc_url TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY(emoji_id)
        );`, "emoji").then(() => {
            // migrate existing emoji
            return store.db.Run(`
                INSERT INTO emoji
                  (emoji_id, name, animated, mxc_url, created_at, updated_at)
                SELECT emoji_id, name, 0 AS animated, mxc_url, created_at, updated_at FROM guild_emoji;
            `).catch(() => {
                // ignore errors
                log.warning("Failed to migrate old data to new table");
            });
        });
    }

    public rollBack(store: DiscordStore): Promise <null> {
        return store.db.Run(
            `DROP TABLE IF EXISTS emoji;`,
        );
    }
}
