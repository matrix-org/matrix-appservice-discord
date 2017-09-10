import * as SQLite3 from "sqlite3";
import * as log from "npmlog";
import * as Bluebird from "bluebird";
import * as fs from "fs";
import { IDbSchema } from "./db/schema/dbschema";
import { IDbData} from "./db/dbdatainterface";
const CURRENT_SCHEMA = 6;
/**
 * Stores data for specific users and data not specific to rooms.
 */
export class DiscordStore {
  /**
   * @param  {string} filepath Location of the SQLite database file.
   */
  public db: any;
  private version: number;
  private filepath: string;
  constructor (filepath: string) {
    this.version = null;
    this.filepath = filepath;
  }

  public backup_database(): Promise<null> {
    if (this.filepath === ":memory:") {
      log.info("DiscordStore", "Can't backup a :memory: database.");
      return Promise.resolve();
    }
    const BACKUP_NAME = this.filepath + ".backup";

    return new Promise((resolve, reject) => {
      // Check to see if a backup file already exists.
      fs.access(BACKUP_NAME, (err) => {
        return resolve(err === null);
      });
    }).then((result) => {
      return new Promise((resolve, reject) => {
        if (!result) {
          log.warn("DiscordStore", "NOT backing up database while a file already exists");
          resolve(true);
          return;
        }
        const rd = fs.createReadStream(this.filepath);
        rd.on("error", reject);
        const wr = fs.createWriteStream(BACKUP_NAME);
        wr.on("error", reject);
        wr.on("close", resolve);
        rd.pipe(wr);
      });
    });
  }

  /**
   * Checks the database has all the tables needed.
   */
  public async init (overrideSchema: number = 0) {
    log.info("DiscordStore", "Starting DB Init");
    await this.open_database();
    let version = await this.getSchemaVersion();
    const targetSchema = overrideSchema || CURRENT_SCHEMA;
    while (version < targetSchema) {
      version++;
      const schemaClass = require(`./db/schema/v${version}.js`).Schema;
      const schema = (new schemaClass() as IDbSchema);
      log.info("DiscordStore", `Updating database to v${version}, "${schema.description}"`);
      try {
        await schema.run(this);
        log.info("DiscordStore", "Updated database to version %s", version);
      } catch (ex) {
        log.error("DiscordStore", "Couldn't update database to schema %s", version);
        log.error("DiscordStore", ex);
        log.info("DiscordStore", "Rolling back to version %s", version - 1);
        try {
          await schema.rollBack(this);
        } catch (ex) {
          log.error("DiscordStore", ex);
          throw Error("Failure to update to latest schema. And failed to rollback.");
        }
        throw Error("Failure to update to latest schema.");
      }
      this.version = version;
      await this.setSchemaVersion(version);
    }
    log.info("DiscordStore", "Updated database to the latest schema");
  }

  public close () {
    this.db.close();
  }

  public create_table (statement: string, tablename: string): Promise<null|Error> {
    return this.db.runAsync(statement).then(() => {
      log.info("DiscordStore", "Created table", tablename);
    }).catch((err) => {
      throw new Error(`Error creating '${tablename}': ${err}`);
    });
  }

  public add_user_token(userId: string, discordId: string, token: string): Promise<null> {
    log.silly("SQL", "add_user_token => %s", userId);
    return Promise.all([
        this.db.runAsync(
          `
          INSERT INTO user_id_discord_id (discord_id,user_id) VALUES ($userId,$discordId);
          `
        , {
            $userId: userId,
            $discordId: discordId,
        }),
        this.db.runAsync(
          `
          INSERT INTO discord_id_token (discord_id,token) VALUES ($discordId,$token);
          `
        , {
            $discordId: discordId,
            $token: token,
        }),
    ]).catch( (err) => {
      log.error("DiscordStore", "Error storing user token %s", err);
      throw err;
    });
  }

  public delete_user_token(discordId: string): Promise<null> {
    log.silly("SQL", "delete_user_token => %s", discordId);
    return this.db.execAsync(
      `
      DELETE FROM user_id_discord_id WHERE discord_id = $id;
      DELETE FROM discord_id_token WHERE discord_id = $id;
      `
    , {
      $id: discordId,
    }).catch( (err) => {
      log.error("DiscordStore", "Error deleting user token %s", err);
      throw err;
    });
  }

  public get_user_discord_ids(userId: string): Promise<string[]> {
    log.silly("SQL", "get_user_discord_ids => %s", userId);
    return this.db.getAsync(
      `
      SELECT discord_id
      FROM user_id_discord_id
      WHERE user_id = $userId
      `, {
        $userId: userId,
      },
    ).then( (rows) => {
      if (rows !== undefined) {
        rows.map((row) => row.discord_id);
      } else {
        return [];
      }
    }).catch( (err) => {
      log.error("DiscordStore", "Error getting discord ids  %s", err.Error);
      throw err;
    });
  }

  public get_token(discordId: string): Promise<string> {
    log.silly("SQL", "discord_id_token => %s", discordId);
    return this.db.getAsync(
      `
      SELECT token
      FROM discord_id_token
      WHERE discord_id = $discordId
      `, {
        $discordId: discordId,
      },
    ).then( (row) => {
      return row !== undefined ? row.token : null;
    }).catch( (err) => {
      log.error("DiscordStore", "Error getting discord ids  %s", err.Error);
      throw err;
    });
  }

  public get_dm_room(discordId, discordChannel): Promise<string> {
    log.silly("SQL", "get_dm_room => %s", discordChannel); // Don't show discordId for privacy reasons
    return this.db.getAsync(
      `
      SELECT room_id
      FROM dm_rooms
      WHERE dm_rooms.discord_id = $discordId
      AND dm_rooms.discord_channel = $discordChannel;
      `
    , {
      $discordId: discordId,
      $discordChannel: discordChannel,
    }).then( (row) => {
      return row !== undefined ? row.room_id : null;
    }).catch( (err) => {
      log.error("DiscordStore", "Error getting room_id  %s", err.Error);
      throw err;
    });
  }

  public set_dm_room(discordId, discordChannel, roomId): Promise<null> {
    log.silly("SQL", "set_dm_room => %s", discordChannel); // Don't show discordId for privacy reasons
    return this.db.runAsync(
      `
      REPLACE INTO dm_rooms (discord_id,discord_channel,room_id)
      VALUES ($discordId,$discordChannel,$roomId);
      `
    , {
      $discordId: discordId,
      $discordChannel: discordChannel,
      $roomId: roomId,
    }).catch( (err) => {
      log.error("DiscordStore", "Error executing set_dm_room query  %s", err.Error);
      throw err;
    });
  }

  public get_all_user_discord_ids(): Promise<any> {
    log.silly("SQL", "get_users_tokens");
    return this.db.allAsync(
      `
      SELECT *
      FROM get_user_discord_ids
      `,
    ).then( (rows) => {
      return rows;
    }).catch( (err) => {
      log.error("DiscordStore", "Error getting user token  %s", err.Error);
      throw err;
    });
  }

  public Get<T extends IDbData>(dbType: {new(): T; }, params: any): Promise<T> {
      const dType = new dbType();
      log.silly("DiscordStore", `get <${dType.constructor.name}>`);
      return dType.RunQuery(this, params).then(() => {
          return dType;
      });
  }

  public Insert<T extends IDbData>(data: T): Promise<null> {
      log.silly("DiscordStore", `insert <${data.constructor.name}>`);
      return data.Insert(this);
  }

  public Update<T extends IDbData>(data: T): Promise<null>  {
      log.silly("DiscordStore", `insert <${data.constructor.name}>`);
      return data.Update(this);
  }

  public Delete<T extends IDbData>(data: T): Promise<null>  {
      log.silly("DiscordStore", `insert <${data.constructor.name}>`);
      return data.Delete(this);
  }

  private getSchemaVersion ( ): Promise<number> {
    log.silly("DiscordStore", "_get_schema_version");
    return this.db.getAsync(`SELECT version FROM schema`).then((row) => {
      return row === undefined ? 0 : row.version;
    }).catch( ()  => {
      return 0;
    });
  }

  private setSchemaVersion (ver: number): Promise<any> {
    log.silly("DiscordStore", "_set_schema_version => %s", ver);
    return this.db.getAsync(
      `
      UPDATE schema
      SET version = $ver
      `, {$ver: ver},
    );
  }

  private open_database(): Promise<null|Error> {
    log.info("DiscordStore", "Opening SQLITE database %s", this.filepath);
    return new Promise((resolve, reject) => {
      this.db = new SQLite3.Database(this.filepath, (err) => {
        if (err) {
          log.error("DiscordStore", "Error opening database, %s");
          reject(new Error("Couldn't open database. The appservice won't be able to continue."));
          return;
        }
        this.db = Bluebird.promisifyAll(this.db);
        resolve();
      });
    });
  }
}
