import {IDbSchema} from "./dbschema";
import {DiscordStore} from "../../store";
export class Schema implements IDbSchema {
    public description = "Schema, Client Auth Table";
    public async run(store: DiscordStore): Promise<void> {
        await store.create_table(`
            CREATE TABLE schema (
                version	INTEGER UNIQUE NOT NULL
            );`, "schema");
        await store.db.Exec("INSERT INTO schema VALUES (0);");
        await store.create_table(`
            CREATE TABLE user_tokens (
                userId TEXT UNIQUE NOT NULL,
                token TEXT UNIQUE NOT NULL
            );`, "user_tokens");
    }
    public async rollBack(store: DiscordStore): Promise<void> {
        await store.db.Exec(
            `DROP TABLE IF EXISTS schema;
            DROP TABLE IF EXISTS user_tokens`,
        );
    }
}
