export interface ISqlCommandParameters {
    [paramKey: string]: number | boolean | string | Promise<number | boolean | string>;
}

export interface ISqlRow {
    [key: string]: number | boolean | string;
}

export interface IDatabaseConnector {
    Open(): void;
    Get(sql: string, parameters?: ISqlCommandParameters): Promise<ISqlRow>;
    All(sql: string, parameters?: ISqlCommandParameters): Promise<ISqlRow[]>;
    Run(sql: string, parameters?: ISqlCommandParameters): Promise<void>;
    Close(): Promise<void>;
    Exec(sql: string): Promise<void>;
}
