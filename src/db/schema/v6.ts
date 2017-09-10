import {IDbSchema} from "./dbschema";
import {DiscordStore} from "../../store";
import {DiscordClientFactory} from "../../clientfactory";
import * as log from "npmlog";
import * as Bluebird from "bluebird";

export class Schema implements IDbSchema {
  public description = "create event_store and discord_msg_store tables";
  public async run(store: DiscordStore): Promise<Error> {
    await store.db.execAsync(
        `DROP TABLE IF EXISTS event_store;`,
    );
    await store.create_table(`
      CREATE TABLE event_store (
        matrix_id TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        PRIMARY KEY(matrix_id, discord_id)
    );`, "event_store");
    return await store.create_table(`
      CREATE TABLE discord_msg_store (
        msg_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        PRIMARY KEY(msg_id)
    );`, "discord_msg_store");
  }

  public rollBack(store: DiscordStore): Promise <null> {
    return store.db.execAsync(
      `DROP TABLE IF EXISTS event_store;`,
      `DROP TABLE IF EXISTS discord_msg_store;`,
    );
  }
}
