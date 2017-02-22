import * as SQLite3 from "sqlite3";
import * as log from "npmlog";
import * as Bluebird from "bluebird";
import { IDbSchema } from "./dbschema/dbschema";

const CURRENT_SCHEMA = 1;
/**
 * Stores data for specific users and data not specific to rooms.
 */
export class DiscordStore {
  /**
   * @param  {string} filepath Location of the SQLite database file.
   */
  public db: any;
  private version: number;
  constructor (filepath) {
    this.db = new SQLite3.Database(filepath, (err) => {
      if (err) {
        log.error("DiscordStore", "Error opening database, %s");
        throw new Error("Couldn't open database. The appservice won't be able to continue.");
      }
    });
    this.db = Bluebird.promisifyAll(this.db);
    this.version = null;
  }

  /**
   * Checks the database has all the tables needed.
   */
  public init () {
    log.info("DiscordStore", "Starting DB Init");
    let oldVersion;
    let version;
    return this.getSchemaVersion().then( (v) => {
      oldVersion = v;
      version = v;
      let promises = [];
      while (version < CURRENT_SCHEMA) {
        version++;
        const schemaClass = require(`./dbschema/v${version}.js`).Schema;
        const schema = (new schemaClass() as IDbSchema);
        log.info("DiscordStore", `Updating database to v${version}, ${schema.description}`);
        promises.push(schema.run(this).then(() => {
          log.info("DiscordStore", "Updated database v%s", version);
        }));
        this.version = version;
      }
      return Promise.all(promises);
    }).then( () => {
      return this.setSchemaVersion(oldVersion, version).then( () => {
        log.info("DiscordStore", "Updated database to the latest schema");
      });
    }).catch( (err) => {
      log.error("DiscordStore", "Couldn't update database to the latest version! Bailing");
      throw err;
    });
  }

  public create_table (statement, tablename) {
    return this.db.runAsync(statement).then(() => {
      log.info("DiscordStore", "Created table ", tablename);
    }).catch((err) => {
      throw new Error(`Error creating '${tablename}': ${err}`);
    });
  }

  public close () {
    this.db.close();
  }

  public set_user_token(userId: string, token: string) {
    log.silly("SQL", "set_user_token => %s", userId);
    return this.db.runAsync(
      `REPLACE INTO user_tokens (userId,token) VALUES ($id,$token);`
    , {
      $id: userId,
      $token: token
    }).catch(err => {
      log.error("TwitDB", "Error storing user token %s", err);
      throw err;
    });
  }

  public get_user_token(userId: string): Promise<string> {
    log.silly("SQL", "get_user_token => %s", userId);
    return this.db.getAsync(
      `
      SELECT token
      FROM user_tokens
      WHERE user_tokens.userId = $id;
      `
    , {
      $id: userId
    }).then(row => {
      return row !== undefined ? row.token : null;
    }).catch( err => {
      log.error("TwitDB", "Error getting user token  %s", err.Error);
      throw err;
    });
  }

  private getSchemaVersion ( ) {
    log.silly("DiscordStore", "_get_schema_version");
    return this.db.getAsync(`SELECT version FROM schema`).then((row) => {
      return row === undefined ? 0 : row.version;
    }).catch( ()  => {
      return 0;
    });
  }

  private setSchemaVersion (oldVer: number, ver: number) {
    log.silly("DiscordStore", "_set_schema_version => %s", ver);
    return this.db.getAsync(
      `
      UPDATE schema
      SET version = $ver
      WHERE version = $old_ver
      `, {$ver: ver, $old_ver: oldVer},
    );
  }
}
