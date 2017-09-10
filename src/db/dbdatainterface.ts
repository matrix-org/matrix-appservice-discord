import { DiscordStore } from "../store";

export interface IDbData {
    Result: boolean;
    RunQuery(store: DiscordStore, params: any);
    Insert(store: DiscordStore);
    Update(store: DiscordStore);
}
