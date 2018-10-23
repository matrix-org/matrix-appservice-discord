import * as Database from "better-sqlite3";
import { Log } from "../log";
const log = new Log("SQLite3");

export class SQLite3 {
    private db: Database;
    constructor (private filename: string) {

    }

    public async Open() {
        log.info(`Opening ${this.filename}`);
        this.db = new Database(this.filename);
    }

    public async Get(sql: string, parameters?: any): Promise<any> {
        log.silly("Get:", sql);
        return this.db.prepare(sql).get(parameters || []);
    }

    public async All(sql: string, parameters?: any): Promise<any[]> {
        log.silly("All:", sql);
        return this.db.prepare(sql).all(parameters || []);
    }

    public async Run(sql: string, parameters?: any): Promise<any> {
        log.silly("Run:", sql);
        return this.db.prepare(sql).run(parameters || []);
    }

    public async Close(): Promise<void> {
        this.db.close();
    }

    public async Exec(sql: string): Promise<any> {
        log.silly("Exec:", sql);
        return this.db.exec(sql);
    }
}
