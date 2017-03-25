import {IDbSchema} from "./dbschema";
import {DiscordStore} from "../store";
import { Client } from "discord.js";
import * as log from "npmlog";
import * as Bluebird from "bluebird";

const READY_TIMEOUT = 5000;

export class Schema implements IDbSchema {
  public description = "user_tokens split into user_id_discord_id";
  public run(store: DiscordStore): Promise<null> {
    const promise = Promise.all([store.create_table(`
      CREATE TABLE user_id_discord_id (
        discord_id	TEXT UNIQUE NOT NULL,
        user_id TEXT UNIQUE NOT NULL
      );`, "user_id_discord_id"),
      store.create_table(`
      CREATE TABLE discord_id_token (
        discord_id TEXT UNIQUE NOT NULL,
        token	TEXT NOT NULL
      );`, "discord_id_token",
    )]);
    return promise.then(() => {
      // Backup before moving data.
      return store.backup_database();
    }).then(() => {
      // Move old data to new tables.
      return this.moveUserIds(store);
    }).then(() => {
      log.info("SchemaV3", "Dropping user_tokens. Check backup database for table.");
      // Drop old table.
      return store.db.execAsync(
        `DROP TABLE user_tokens;`,
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
      let promises = [];
      for (const row of rows) {
        let discordId = null;
        log.info("SchemaV3", "Moving %s.", row.userId);
        promises.push(this.getDiscordIdFromToken(row.token).catch((err) => {
          log.info("SchemaV3", "Dropping %s from database due to an invalid token.");
          return null;
        }).then((dId) => {
          if(dId === null) {
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
          if(discordId === null) {
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
        }));
      }
      return Bluebird.all(promises);
    });
  }

  private getDiscordIdFromToken(token: String): any {
    const client: any = new Client({
      fetchAllMembers: false,
      sync: false,
      messageCacheLifetime: 5,
    });
    return new Bluebird((resolve, reject) => {
      client.login(token).catch(reject);
      client.on("ready", () => {
        const id = client.user.id;
        client.destroy();
        resolve(id);
      });
    }).timeout(READY_TIMEOUT).catch((err: Error) => {
      log.warn("SchemaV3", "Could not login as the bot user '%s'", err.message);
      throw Error("Could not retrive ID");
    });
  }

}
