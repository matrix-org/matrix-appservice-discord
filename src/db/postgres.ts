import * as pgPromise from "pg-promise";
import { Log } from "../log";
import { IDatabaseConnector, ISqlCommandParameters } from "./connector";
const log = new Log("SQLite3");

const pgp: pgPromise.IMain = pgPromise({
    // Initialization Options
});

export class Postgres implements IDatabaseConnector {
    public static ParameterizeSql(sql: string): string {
        return sql.replace(/\$((\w|\d|_)+)+/g, (k) => {
            return "${" + k.substr("$".length) + "}";
        });
    }

    // tslint:disable-next-line no-any
    private db: pgPromise.IDatabase<any>;
    constructor(private connectionString: string) {

    }
    public Open() {
        // Hide username:password
        const logConnString = this.connectionString.substr(
            this.connectionString.indexOf("@") || 0,
        );
        log.info(`Opening ${logConnString}`);
        this.db = pgp(this.connectionString);
    }

    // tslint:disable-next-line no-any
    public async Get(sql: string, parameters?: ISqlCommandParameters): Promise<any> {
        log.silly("Get:", sql);
        return this.db.oneOrNone(Postgres.ParameterizeSql(sql), parameters);
    }

    // tslint:disable-next-line no-any
    public async All(sql: string, parameters?: ISqlCommandParameters): Promise<any[]> {
        log.silly("All:", sql);
        return this.db.many(Postgres.ParameterizeSql(sql), parameters);
    }

    // tslint:disable-next-line no-any
    public async Run(sql: string, parameters?: ISqlCommandParameters): Promise<any> {
        log.silly("Run:", sql);
        return this.db.oneOrNone(Postgres.ParameterizeSql(sql), parameters);
    }

    public async Close(): Promise<void> {
        // Postgres doesn't support disconnecting.
    }

    // tslint:disable-next-line no-any
    public async Exec(sql: string): Promise<any> {
        log.silly("Exec:", sql);
        return this.db.none(sql);
    }
}
