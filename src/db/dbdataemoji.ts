import { DiscordStore } from "../store";
import { IDbData } from "./dbdatainterface";

export class DbEmoji implements IDbData {
    public EmojiId: string;
    public Name: string;
    public Animated: boolean;
    public MxcUrl: string;
    public CreatedAt: number;
    public UpdatedAt: number;
    public Result: boolean;

    public RunQuery(store: DiscordStore, params: any): Promise<null> {
        return store.db.getAsync(`
            SELECT *
            FROM emoji
            WHERE emoji_id = $id`, {
                $id: params.emoji_id,
            }).then((row) => {
                this.Result = row !== undefined;
                if (this.Result) {
                    this.EmojiId = row.emoji_id;
                    this.Name = row.name;
                    this.Animated = row.animated;
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
            INSERT INTO emoji
            (emoji_id,name,animated,mxc_url,created_at,updated_at)
            VALUES ($emoji_id,$name,$animated,$mxc_url,$created_at,$updated_at);`, {
                $emoji_id: this.EmojiId,
                $name: this.Name,
                $animated: this.Animated,
                $mxc_url: this.MxcUrl,
                $created_at: this.CreatedAt,
                $updated_at: this.UpdatedAt,
        });
    }

    public Update(store: DiscordStore) {
        // Ensure this has incremented by 1 for Insert+Update operations.
        this.UpdatedAt = new Date().getTime() + 1;
        return store.db.runAsync(`
            UPDATE emoji
            SET name = $name,
            animated = $animated,
            mxc_url = $mxc_url,
            updated_at = $updated_at
            WHERE
            emoji_id = $emoji_id`, {
                $emoji_id: this.EmojiId,
                $name: this.Name,
                $animated: this.Animated,
                $mxc_url: this.MxcUrl,
                $updated_at: this.UpdatedAt,
        });
    }

    public Delete(store: DiscordStore): Promise<null> {
        throw new Error("Delete is not implemented");
    }
}
