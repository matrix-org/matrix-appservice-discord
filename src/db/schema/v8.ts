import {IDbSchema} from "./dbschema";
import {DiscordStore} from "../../store";
import {DiscordClientFactory} from "../../clientfactory";
import * as Bluebird from "bluebird";
import { Log } from "../../log";
const log = new Log("SchemaV8");

export class Schema implements IDbSchema {
    public description = "redesign dm room table";
    public async run(store: DiscordStore): Promise<any> {
        try {
            await store.db.Exec(`DROP TABLE dm_rooms;`);
        } catch (e) {
            log.warn("Failed to delete dm_rooms, but continuing:", e);
        }

        return store.create_table(`
          CREATE TABLE dm_room (
            room_id TEXT NOT NULL UNIQUE,
            chan_id TEXT NOT NULL UNIQUE,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )`, "dm_room");
    }

    public rollBack(store: DiscordStore): Promise <null> {
        log.error("Rolling back from a failed v7->v8 upgrade, but the dm_rooms has been dropped!");
        return store.db.Exec(
            `DROP TABLE IF EXISTS dm_room;`,
        );
    }
}
