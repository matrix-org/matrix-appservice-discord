import {IDbSchema} from "./dbschema";
import {DiscordStore} from "../../store";
import {DiscordClientFactory} from "../../clientfactory";
import * as log from "npmlog";
import * as Bluebird from "bluebird";

export class Schema implements IDbSchema {
    public description = "redesign dm room table";
    public async run(store: DiscordStore): Promise<any> {
        try {
            await store.db.execAsync(`DROP TABLE dm_rooms;`);
        } catch (e) {
            log.warn("DiscordSchema", "Failed to delete dm_rooms, but continuing:", e);
        }

        return store.create_table(`
          CREATE TABLE dm_room (
            discord_id TEXT NOT NULL,
            matrix_user_id TEXT NOT NULL,
            room_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(discord_id,matrix_user_id)
          );`, "dm_room");
    }

    public rollBack(store: DiscordStore): Promise <null> {
        log.error("DiscordSchema", "Rolling back from a failed v7->v8 upgrade, but the dm_rooms has been dropped!");
        return store.db.execAsync(
            `DROP TABLE IF EXISTS dm_room;`,
        );
    }
}
