import { DiscordStore } from "../store";
import { IDbData } from "./dbdatainterface";
import * as log from "npmlog";

export class DbDmRoom implements IDbData {
    public RoomId: string;
    public UserId: string;
    public DiscordId: string;
    public Result: boolean;
    public CreatedAt: number;
    public UpdatedAt: number;

    public RunQuery(store: DiscordStore, params: any): Promise<null> {
        let selectStatement = "";
        if(params.room_id !== undefined) {
            selectStatement = "WHERE room_id = $room_id";
        } else if (params.user_id !== undefined && params.discord_id !== undefined) {
            selectStatement = "WHERE matrix_user_id = $user_id AND discord_id = $discord_id";
        } else {
            throw Error("Missing room_id|user_id,discord_id");
        }

        return store.db.getAsync(`
            SELECT *
            FROM dm_room
            ${selectStatement}`, {
            $room_id: params.room_id,
            $user_id: params.user_id,
            $discord_id: params.discord_id,
        }).then((row) => {
            this.Result = row !== undefined;
            if (this.Result) {
                this.RoomId = row.room_id;
                this.UserId = row.matrix_user_id;
                this.DiscordId = row.discord_id;
            }
        });
    }

    public Insert(store: DiscordStore): Promise<null> {
        this.CreatedAt = new Date().getTime();
        this.UpdatedAt = this.CreatedAt;
        return store.db.runAsync(`
            INSERT INTO dm_room
            (discord_id,matrix_user_id,room_id,created_at,updated_at)
            VALUES ($discord_id,$user_id,$room_id,$created_at,$updated_at);`, {
            $room_id: this.RoomId,
            $user_id: this.UserId,
            $discord_id: this.DiscordId,
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
