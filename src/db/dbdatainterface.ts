import { DiscordStore } from "../store";

export interface IDbData {
    Result: boolean;
    RunQuery(store: DiscordStore, params: any): Promise<null|Error>;
    Insert(store: DiscordStore): Promise<null|Error>;
    Update(store: DiscordStore): Promise<null|Error>;
    Delete(store: DiscordStore): Promise<null|Error>;
}

export interface IDbDataMany extends IDbData {
    ResultCount: number;
    Next(): boolean;
}
