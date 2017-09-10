import {IDbSchema} from "./dbschema";
import {DiscordStore} from "../../store";
export class Schema implements IDbSchema {
  public description = "Create DM Table, User Options";
  public run(store: DiscordStore): Promise<null> {
    return Promise.all([
      store.create_table(`
      CREATE TABLE dm_rooms (
        discord_id	TEXT NOT NULL,
        channel_id	TEXT NOT NULL,
        room_id	TEXT UNIQUE NOT NULL
      );`, "dm_rooms"),
      store.create_table(`
      CREATE TABLE client_options (
        discord_id	TEXT UNIQUE NOT NULL,
        options	INTEGER NOT NULL
      );`, "client_options",
    )]);
  }
  public rollBack(store: DiscordStore): Promise<null> {
    return store.db.execAsync(
      `DROP TABLE IF EXISTS dm_rooms;
      DROP TABLE IF EXISTS client_options;`,
    );
  }
}
