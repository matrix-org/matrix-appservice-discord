import { DiscordStore } from "../store";

export interface IDbData {
    Result: boolean;
    RunQuery(store: DiscordStore, params: any): Promise<null>;
    Insert(store: DiscordStore): Promise<null>;
    Update(store: DiscordStore): Promise<null>;
}
