/*
Copyright 2018 matrix-appservice-discord

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

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

    public async Get(sql: string, parameters?: ISqlCommandParameters): Promise<ISqlRow|null> {
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
