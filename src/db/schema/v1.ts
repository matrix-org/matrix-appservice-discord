import {IDbSchema} from "./dbschema";
import {DiscordStore} from "../../store";
export class Schema implements IDbSchema {
  public description = "Schema, Client Auth Table";
  public run(store: DiscordStore): Promise<null> {
    return store.create_table(`
    CREATE TABLE schema (
      version	INTEGER UNIQUE NOT NULL
    );`, "schema").then(() => {
      return store.db.runAsync("INSERT INTO schema VALUES (0);");
    }).then(() => {
      return store.create_table(`
      CREATE TABLE user_tokens (
        userId TEXT UNIQUE NOT NULL,
        token TEXT UNIQUE NOT NULL
      );`, "user_tokens");
    });
  }
  public rollBack(store: DiscordStore): Promise<null> {
    return store.db.execAsync(
      `DROP TABLE IF EXISTS schema;
      DROP TABLE IF EXISTS user_tokens`,
    );
  }
}
