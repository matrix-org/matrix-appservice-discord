import {IDbSchema} from "./dbschema";
import {DiscordStore} from "../../store";
import {DiscordClientFactory} from "../../clientfactory";
import * as log from "npmlog";
import * as Bluebird from "bluebird";

export class Schema implements IDbSchema {
  public description = "create event_store table";
  public run(store: DiscordStore): Promise<null> {
    return store.create_table(`
      CREATE TABLE event_store (
        matrix_id TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        PRIMARY KEY(matrix_id, discord_id)
    );`, "event_store");
  }

  public rollBack(store: DiscordStore): Promise <null> {
    return store.db.execAsync(
      `DROP TABLE IF EXISTS guild_emoji;`,
    );
  }
}
