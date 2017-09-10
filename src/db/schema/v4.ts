import {IDbSchema} from "./dbschema";
import {DiscordStore} from "../../store";
import {DiscordClientFactory} from "../../clientfactory";
import * as log from "npmlog";
import * as Bluebird from "bluebird";

export class Schema implements IDbSchema {
  public description = "create guild emoji table";
  public run(store: DiscordStore): Promise<null> {
    return store.create_table(`
      CREATE TABLE guild_emoji (
        emoji_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mxc_url TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(emoji_id, guild_id)
    );`, "guild_emoji");
  }

  public rollBack(store: DiscordStore): Promise <null> {
    return store.db.execAsync(
      `DROP TABLE IF EXISTS guild_emoji;`,
    );
  }
}
