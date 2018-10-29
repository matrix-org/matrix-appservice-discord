import * as Database from "better-sqlite3";
import { Log } from "../log";
import { IDatabaseConnector } from "./connector";
const log = new Log("SQLite3");

export class SQLite3 implements IDatabaseConnector {
    private db: Database;
    constructor(private filename: string) {

    }

    public async Open() {
        log.info(`Opening ${this.filename}`);
        this.db = new Database(this.filename);
    }

    // tslint:disable-next-line no-any
    public async Get(sql: string, parameters?: any): Promise<any> {
        log.silly("Get:", sql);
        return this.db.prepare(sql).get(parameters || []);
    }

    // tslint:disable-next-line no-any
    public async All(sql: string, parameters?: any): Promise<any[]> {
        log.silly("All:", sql);
        return this.db.prepare(sql).all(parameters || []);
    }

    // tslint:disable-next-line no-any
    public async Run(sql: string, parameters?: any): Promise<any> {
        log.silly("Run:", sql);
        return this.db.prepare(sql).run(parameters || []);
    }

    public async Close(): Promise<void> {
        this.db.close();
    }

    // tslint:disable-next-line no-any
    public async Exec(sql: string): Promise<any> {
        log.silly("Exec:", sql);
        return this.db.exec(sql);
    }
}
