import * as Database from "better-sqlite3";
import { Log } from "../log";
import { IDatabaseConnector, ISqlCommandParameters, ISqlRow } from "./connector";
const log = new Log("SQLite3");

export class SQLite3 implements IDatabaseConnector {
    private db: Database;
    constructor(private filename: string) {

    }

    public async Open() {
        log.info(`Opening ${this.filename}`);
        this.db = new Database(this.filename);
    }

    public async Get(sql: string, parameters?: ISqlCommandParameters): Promise<ISqlRow> {
        log.silly("Get:", sql);
        return this.db.prepare(sql).get(parameters || []);
    }

    public async All(sql: string, parameters?: ISqlCommandParameters): Promise<ISqlRow[]> {
        log.silly("All:", sql);
        return this.db.prepare(sql).all(parameters || []);
    }

    public async Run(sql: string, parameters?: ISqlCommandParameters): Promise<void> {
        log.silly("Run:", sql);
        return this.db.prepare(sql).run(parameters || []);
    }

    public async Close(): Promise<void> {
        this.db.close();
    }

    public async Exec(sql: string): Promise<void> {
        log.silly("Exec:", sql);
        return this.db.exec(sql);
    }
}
