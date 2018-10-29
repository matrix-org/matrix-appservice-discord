import {IDbSchema} from "./dbschema";
import {DiscordStore} from "../../store";
import {DiscordClientFactory} from "../../clientfactory";
import { Log } from "../../log";

const log = new Log("SchemaV3");

export class Schema implements IDbSchema {
    public description = "user_tokens split into user_id_discord_id";
    public async run(store: DiscordStore): Promise<void> {
        await Promise.all([store.create_table(`
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

        // Backup before moving data.
        await store.backup_database();

        // Move old data to new tables.
        await this.moveUserIds(store);

        // Drop old table.
        await store.db.Run(
            `DROP TABLE IF EXISTS user_tokens;`,
        );
    }

    public async rollBack(store: DiscordStore): Promise <void> {
        await Promise.all([store.db.Run(
            `DROP TABLE IF EXISTS user_id_discord_id;`,
        ), store.db.Run(
            `DROP TABLE IF EXISTS discord_id_token;`,
        )]);
    }

    private async moveUserIds(store: DiscordStore): Promise <null> {
        log.info("Performing one time moving of tokens to new table. Please wait.");
        let rows;
        try {
            rows = await store.db.All(`SELECT * FROM user_tokens`);
        } catch (err) {
            log.error(`
Could not select users from 'user_tokens'.It is possible that the table does
not exist on your database in which case you can proceed safely. Otherwise
a copy of the database before the schema update has been placed in the root
directory.`);
            log.error(err);
            return;
        }
        const promises = [];
        const clientFactory = new DiscordClientFactory(store);
        for (const row of rows) {
            log.info("Moving ", row.userId);
            try {
                const dId = clientFactory.getDiscordId(row.token);
                if (dId === null) {
                    continue;
                }
                log.verbose("INSERT INTO discord_id_token.");
                await store.db.Run(
                    `
                        INSERT INTO discord_id_token (discord_id,token)
                        VALUES ($discordId,$token);
                    `
                    , {
                        $discordId: dId,
                        $token: row.token,
                    });
                log.verbose("INSERT INTO user_id_discord_id.");
                await store.db.Run(
                    `
                        INSERT INTO user_id_discord_id (discord_id,user_id)
                        VALUES ($discordId,$userId);
                    `
                    , {
                        $discordId: dId,
                        $userId: row.userId,
                    });
            } catch (err) {
                log.error(`Couldn't move ${row.userId}'s token into new table.`);
                log.error(err);
            }
        }
    }
}
