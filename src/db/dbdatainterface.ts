import { DiscordStore } from "../store";

export interface IDbData {
    Result: boolean;
    RunQuery(store: DiscordStore, params: any): Promise<void|Error>;
    Insert(store: DiscordStore): Promise<void|Error>;
    Update(store: DiscordStore): Promise<void|Error>;
    Delete(store: DiscordStore): Promise<void|Error>;
}

export interface IDbDataMany extends IDbData {
    ResultCount: number;
    Next(): boolean;
}
