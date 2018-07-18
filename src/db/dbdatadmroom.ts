import { DiscordStore } from "../store";
import { IDbData } from "./dbdatainterface";
import * as log from "npmlog";

export class DbDmRoom implements IDbData {
    public RoomId: string;
    public ChannelId: string;
    public Result: boolean;
    public CreatedAt: number;
    public UpdatedAt: number;

    public RunQuery(store: DiscordStore, params: any): Promise<null> {
        let selectStatement = "";
        if(params.room_id !== undefined) {
            selectStatement = "WHERE room_id = $room_id";
        } else if (params.chan_id !== undefined) {
            selectStatement = "WHERE chan_id = $chan_id";
        } else {
            throw Error("Missing room_id|chan_id");
        }

        return store.db.getAsync(`
            SELECT *
            FROM dm_room
            ${selectStatement}`, {
            $room_id: params.room_id,
            $chan_id: params.chan_id,
        }).then((row) => {
            this.Result = row !== undefined;
            if (this.Result) {
                this.RoomId = row.room_id;
                this.ChannelId = row.chan_id;
                this.CreatedAt = row.created_at;
                this.UpdatedAt = row.updated_at;

            }
        });
    }

    public Insert(store: DiscordStore): Promise<null> {
        this.CreatedAt = new Date().getTime();
        this.UpdatedAt = this.CreatedAt;
        return store.db.runAsync(`
            INSERT INTO dm_room
            (room_id,chan_id,created_at,updated_at)
            VALUES ($room_id,$chan_id, $created_at, $updated_at);`, {
            $room_id: this.RoomId,
            $chan_id: this.ChannelId,
            $created_at: this.CreatedAt,
            $updated_at: this.UpdatedAt,
        });
    }

    public Update(store: DiscordStore): Promise<null> {
        throw new Error("Update is not implemented");
    }

    public Delete(store: DiscordStore): Promise<null> {
        return store.db.runAsync(`
            DELETE FROM dm_room
            WHERE room_id = $room_id`, {
            $room_id: this.RoomId,
        });
    }
}
