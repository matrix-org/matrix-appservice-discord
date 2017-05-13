import {IDbSchema} from "./dbschema";
import {DiscordStore} from "../store";
import {DiscordClientFactory} from "../clientfactory";
import * as log from "npmlog";
import * as Bluebird from "bluebird";

export class Schema implements IDbSchema {
  public description = "user_tokens split into user_id_discord_id";
  public run(store: DiscordStore): Promise<null> {
    const promise = Promise.all([store.create_table(`
      CREATE TABLE user_id_discord_id (
        discord_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        PRIMARY KEY(discord_id, user_id)
      );`, "user_id_discord_id"),
      store.create_table(`
      CREATE TABLE discord_id_token (
        discord_id TEXT UNIQUE NOT NULL,
        token	TEXT NOT NULL,
        PRIMARY KEY(discord_id)
      );`, "discord_id_token",
    )]);
    return promise.then(() => {
      // Backup before moving data.
      return store.backup_database();
    }).then(() => {
      // Move old data to new tables.
      return this.moveUserIds(store);
    }).then(() => {
      // Drop old table.
      return store.db.execAsync(
        `DROP TABLE IF EXISTS user_tokens;`,
      );
    });
  }

  public rollBack(store: DiscordStore): Promise<null> {
    return Promise.all([store.db.execAsync(
      `DROP TABLE IF EXISTS user_id_discord_id;`,
    ), store.db.execAsync(
      `DROP TABLE IF EXISTS discord_id_token;`,
    )]);
  }

  private moveUserIds(store: DiscordStore): Promise<null> {
    log.info("SchemaV3", "Performing one time moving of tokens to new table. Please wait.");
    return store.db.allAsync(
      `
      SELECT *
      FROM user_tokens
      `,
    ).then( (rows) => {
      const promises = [];
      const clientFactory = new DiscordClientFactory(store);
      for (const row of rows) {
        let discordId = null;
        log.info("SchemaV3", "Moving %s.", row.userId);
        promises.push(clientFactory.getDiscordId(row.token).catch((err) => {
          log.info("SchemaV3", "Dropping %s from database due to an invalid token.");
          return null;
        }).then((dId) => {
          if (dId === null) {
            return null;
          }
          discordId = dId;
          log.verbose("SchemaV3", "INSERT INTO discord_id_token.");
          return store.db.runAsync(
            `
            INSERT INTO discord_id_token (discord_id,token)
            VALUES ($discordId,$token);
            `
          , {
            $discordId: discordId,
            $token: row.token,
          });
        }).then(() => {
          if (discordId === null) {
            return null;
          }
          log.verbose("SchemaV3", "INSERT INTO user_id_discord_id.");
          return store.db.runAsync(
            `
            INSERT INTO user_id_discord_id (discord_id,user_id)
            VALUES ($discordId,$userId);
            `
          , {
            $discordId: discordId,
            $userId: row.userId,
          });
        }).catch((err) => {
          log.error(`Couldn't move ${row.userId}'s token into new table.`);
        }));
      }
      return Bluebird.all(promises);
    }).catch((err) => {
      log.error(`
Could not select users from 'user_tokens'.It is possible that the table does
not exist on your database in which case you can proceed safely. Otherwise
a copy of the database before the schema update has been placed in the root
directory.`);
      log.error(err);
      return Promise.resolve();
    }));
  }

}
