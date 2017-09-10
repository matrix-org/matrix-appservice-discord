import { DiscordStore } from "../store";
import { IDbData } from "./dbdatainterface";
import * as log from "npmlog";

export class DbGuildEmoji implements IDbData {
    public EmojiId: string;
    public GuildId: string;
    public Name: string;
    public MxcUrl: string;
    public CreatedAt: number;
    public UpdatedAt: number;
    public Result: boolean;

    public RunQuery(store: DiscordStore, params: any): Promise<null> {
        return store.db.getAsync(`
            SELECT *
            FROM guild_emoji
            WHERE emoji_id = $id`, {
                $id: params.emoji_id,
            }).then((row) => {
                this.Result = row !== undefined;
                if (this.Result) {
                    this.EmojiId = row.emoji_id;
                    this.GuildId = row.guild_id;
                    this.Name = row.name;
                    this.MxcUrl = row.mxc_url;
                    this.CreatedAt = row.created_at;
                    this.UpdatedAt = row.updated_at;
                }
        });
    }

    public Insert(store: DiscordStore): Promise<null> {
        this.CreatedAt = new Date().getTime();
        this.UpdatedAt = this.CreatedAt;
        return store.db.runAsync(`
            INSERT INTO guild_emoji
            (emoji_id,guild_id,name,mxc_url,created_at,updated_at)
            VALUES ($emoji_id,$guild_id,$name,$mxc_url,$created_at,$updated_at);`, {
                $emoji_id: this.EmojiId,
                $guild_id: this.GuildId,
                $name: this.Name,
                $mxc_url: this.MxcUrl,
                $created_at: this.CreatedAt,
                $updated_at: this.UpdatedAt,
        });
    }

    public Update(store: DiscordStore) {
        // Ensure this has incremented by 1 for Insert+Update operations.
        this.UpdatedAt = new Date().getTime() + 1;
        return store.db.runAsync(`
            UPDATE guild_emoji
            SET name = $name,
            mxc_url = $mxc_url,
            updated_at = $updated_at
            WHERE
            emoji_id = $emoji_id
            AND guild_id = $guild_id`, {
                $emoji_id: this.EmojiId,
                $guild_id: this.GuildId,
                $name: this.Name,
                $mxc_url: this.MxcUrl,
                $updated_at: this.UpdatedAt,
        });
    }

    public Delete(store: DiscordStore): Promise<null> {
        throw new Error("Delete is not implemented");
    }
}
