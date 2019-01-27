import { Log } from "../log";
import { IDatabaseConnector } from "./connector";

import * as uuid from "uuid/v4";

const log = new Log("DbRoomStore");

/**
 * A RoomStore compatible with
 * https://github.com/matrix-org/matrix-appservice-bridge/blob/master/lib/components/room-bridge-store.js
 * that accesses the database instead.
 */

interface IRemoteRoomData {
    discord_guild: string;
    discord_channel: string;
    discord_name?: string|null;
    discord_topic?: string|null;
    discord_type?: string|null;
    discord_iconurl?: string|null;
    discord_iconurl_mxc?: string|null;
    update_name?: number|null;
    update_topic?: number|null;
    update_icon?: number|null;
    plumbed?: number|null;
}

export class RemoteStoreRoom {
    public data: IRemoteRoomData;
    constructor(public readonly roomId: string, data: IRemoteRoomData) {
        for (const k of ["discord_guild", "discord_channel", "discord_name",
        "discord_topic", "discord_iconurl", "discord_iconurl_mxc", "discord_type"]) {
            data[k] = typeof(data[k]) === "number" ? String(data[k]) : data[k] || null;
        }
        for (const k of ["update_name", "update_topic", "update_icon", "plumbed"]) {
            data[k] = Number(data[k]) || 0;
        }
        this.data = data;
    }

    public getId() {
        return this.roomId;
    }

    public get(key: string): string|boolean|null {
        return this.data[key];
    }

    public set(key: string, value: string|boolean|null) {
        this.data[key] = typeof(value) === "boolean" ? Number(value) : value;
    }
}

export class MatrixStoreRoom {
    constructor(public readonly roomId: string) { }

    public getId() {
        return this.roomId;
    }
}

export interface IRoomStoreEntry {
    id: string;
    matrix: MatrixStoreRoom|null;
    remote: RemoteStoreRoom|null;
}

const ENTRY_CACHE_LIMETIME = 30000;

// XXX: This only implements functions used in the bridge at the moment.
export class DbRoomStore {

    private entriesMatrixIdCache: Map<string, {e: IRoomStoreEntry[], ts: number}>;

    constructor(private db: IDatabaseConnector) {
        this.entriesMatrixIdCache = new Map();
    }

    public async upsertEntry(entry: IRoomStoreEntry) {
        const promises: Promise<void>[] = [];
        // N.b. Sqlite and postgres don't really have a easy way to do upserts.
        const row = (await this.db.Get("SELECT * FROM room_entries WHERE id = $id", {id: entry.id})) || {};

        if (!row.id) {
            // Doesn't exist at all, create the room_entries row.
            const values = {
                id: entry.id,
                matrix: entry.matrix ? entry.matrix.roomId : null,
                remote: entry.remote ? entry.remote.roomId : null,
            };
            try {
                await this.db.Run(`INSERT INTO room_entries VALUES ($id, $matrix, $remote)`, values);
                log.verbose("Created new entry " + entry.id);
            } catch (ex) {
                log.error("Failed to insert room entry", ex);
                throw Error("Failed to insert room entry");
            }
        }

        const matrixId = entry.matrix ? entry.matrix.roomId : null;
        const remoteId = entry.remote ? entry.remote.roomId : null;
        const mxIdDifferent = matrixId !== row.matrix_id;
        const rmIdDifferent = remoteId !== row.remote_id;
        // Did the room ids change?
        if (row.id && (mxIdDifferent || rmIdDifferent)) {
            const items: string[] = [];

            if (mxIdDifferent) {
                items.push("matrix_id = $matrixId");
            }

            if (rmIdDifferent) {
                items.push("remote_id = $remoteId");
            }

            await this.db.Run(`UPDATE room_entries SET ${items.join(", ")} WHERE id = $id`,
                {
                    id: entry.id,
                    matrixId: matrixId as string|null,
                    remoteId: remoteId as string|null,
                },
            );
        }

        // Matrix room doesn't store any data.

        if (entry.remote) {
            await this.upsertRoom(entry.remote);
        }
    }

    public async getEntriesByMatrixId(matrixId: string): Promise<IRoomStoreEntry[]> {
        const cached = this.entriesMatrixIdCache.get(matrixId);
        if (cached && cached.ts + ENTRY_CACHE_LIMETIME > Date.now()) {
            return cached.e;
        }
        const entries = await this.db.All(
            "SELECT * FROM room_entries WHERE matrix_id = $id", {id: matrixId},
        );
        const res: IRoomStoreEntry[] = [];
        for (const entry of entries) {
            const remoteId = entry.remote_id as string || "";
            const row = await this.db.Get(
                "SELECT * FROM remote_room_data WHERE room_id = $rid",
                {rid: remoteId},
            );
            if (!row) { continue; }

            res.push({
                id: (entry.id as string),
                matrix: matrixId ? new MatrixStoreRoom(matrixId) : null,
                // tslint:disable-next-line no-any
                remote: remoteId ? new RemoteStoreRoom(remoteId, row as any) : null,
            });
        }
        this.entriesMatrixIdCache.set(matrixId, {e: res, ts: Date.now()});
        return res;
    }

    public async getEntriesByMatrixIds(matrixIds: string[]): Promise<IRoomStoreEntry[]> {
        const entries = await this.db.All(
            `SELECT * FROM room_entries WHERE matrix_id IN ('${matrixIds.join("','")}')`,
        );
        const res: IRoomStoreEntry[] = [];
        for (const entry of entries) {
            const matrixId = entry.matrix_id as string || "";
            const remoteId = entry.remote_id as string || "";
            const row = await this.db.Get(
                "SELECT * FROM remote_room_data WHERE room_id = $rid",
                {rid: remoteId},
            );
            if (!row) { continue; }

            res.push({
                id: (entry.id as string),
                matrix: matrixId ? new MatrixStoreRoom(matrixId) : null,
                // tslint:disable-next-line no-any
                remote: remoteId ? new RemoteStoreRoom(remoteId, row as any) : null,
            });
        }
        return res;
    }

    public async linkRooms(matrixRoom: MatrixStoreRoom, remoteRoom: RemoteStoreRoom) {
        await this.upsertRoom(remoteRoom);

        const values = {
            id: uuid(),
            matrix: matrixRoom.roomId,
            remote: remoteRoom.roomId,
        };

        try {
            await this.db.Run(`INSERT INTO room_entries VALUES ($id, $matrix, $remote)`, values);
            log.verbose("Created new entry " + values.id);
        } catch (ex) {
            log.error("Failed to insert room entry", ex);
            throw Error("Failed to insert room entry");
        }
    }

    public async setMatrixRoom(matrixRoom: MatrixStoreRoom) {
        // This no-ops, because we don't store anything interesting.
    }

    public async getEntriesByRemoteRoomData(data: {[key: string]: string}): Promise<IRoomStoreEntry[]> {
        const whereClaues = Object.keys(data).map((key) => {
            return `${key} = $${key}`;
        }).join(" AND ");
        const sql = `
        SELECT * FROM remote_room_data
        INNER JOIN room_entries ON remote_room_data.room_id = room_entries.remote_id
        WHERE ${whereClaues}`;
        // tslint:disable-next-line no-any
        return (await this.db.All(sql, data as any)).map((row) => {
            const id = row.id as string;
            const matrixId = row.matrix_id;
            const remoteId = row.room_id;
            return {
                id,
                matrix: matrixId ? new MatrixStoreRoom(matrixId as string) : null,
                // tslint:disable-next-line no-any
                remote: matrixId ? new RemoteStoreRoom(remoteId as string, row as any) : null,
            };
        });
    }

    public async removeEntriesByRemoteRoomId(remoteId: string) {
        await this.db.Run(`DELETE FROM room_entries WHERE remote_id = $remoteId`, {remoteId});
        await this.db.Run(`DELETE FROM remote_room_data WHERE room_id = $remoteId`, {remoteId});
    }

    public async removeEntriesByMatrixRoomId(matrixId: string) {
        await this.db.Run(`DELETE FROM room_entries WHERE matrix_id = $matrixId`, {matrixId});
        await this.db.Run(`DELETE FROM remote_room_data WHERE room_id = $matrixId`, {matrixId});
    }

    private async upsertRoom(room: RemoteStoreRoom) {
        const existingRow = await this.db.Get(
            "SELECT * FROM remote_room_data WHERE room_id = $id",
            {id: room.roomId},
        );

        if (!room.data) {
            throw new Error("Tried to upsert a room with undefined data");
        }

        const data = {
            discord_channel:     room.data.discord_channel,
            discord_guild:       room.data.discord_guild,
            discord_iconurl:     room.data.discord_iconurl,
            discord_iconurl_mxc: room.data.discord_iconurl_mxc,
            discord_name:        room.data.discord_name,
            discord_topic:       room.data.discord_topic,
            discord_type:        room.data.discord_type,
            plumbed:             room.data.plumbed || 0,
            update_icon:         room.data.update_icon || 0,
            update_name:         room.data.update_name || 0,
            update_topic:        room.data.update_topic || 0,
        } as IRemoteRoomData;

        if (!existingRow) {
            // Insert new data.
            await this.db.Run(
            `INSERT INTO remote_room_data VALUES (
                $id,
                $discord_guild,
                $discord_channel,
                $discord_name,
                $discord_topic,
                $discord_type,
                $discord_iconurl,
                $discord_iconurl_mxc,
                $update_name,
                $update_topic,
                $update_icon,
                $plumbed
            )
            `,
            {
                id: room.roomId,
                // tslint:disable-next-line no-any
                ...data as any,
            });
            return;
        }

        const keysToUpdate = { };

        // New keys
        Object.keys(room.data).filter(
            (k: string) => existingRow[k] === null).forEach((key) => {
                keysToUpdate[key] = room.data[key];
        });

        // Updated keys
        Object.keys(room.data).filter(
            (k: string) => existingRow[k] !== room.data[k]).forEach((key) => {
            keysToUpdate[key] = room.data[key];
        });

        if (Object.keys(keysToUpdate).length === 0) {
            return;
        }

        const setStatement = Object.keys(keysToUpdate).map((k) => {
            return `${k} = $${k}`;
        }).join(", ");

        try {
            await this.db.Run(`UPDATE remote_room_data SET ${setStatement} WHERE room_id = $id`,
            {
                id: room.roomId,
                // tslint:disable-next-line no-any
                ...keysToUpdate,
            });
            log.verbose("Upserted room " + room.roomId);
        } catch (ex) {
            log.error("Failed to upsert room", ex);
            throw Error("Failed to upsert room");
        }
    }
}
