import {IDbSchema} from "./dbschema";
import {DiscordStore} from "../../store";

export class Schema implements IDbSchema {
  public description = "create event_store table";
  public run(store: DiscordStore): Promise<Error> {
    return store.create_table(`
      CREATE TABLE event_store (
        matrix_id TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        PRIMARY KEY(matrix_id, discord_id)
    );`, "event_store");
  }

  public rollBack(store: DiscordStore): Promise <Error> {
    return store.db.execAsync(
      `DROP TABLE IF EXISTS event_store;`,
    );
  }
}
