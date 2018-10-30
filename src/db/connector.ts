export interface ISqlCommandParameters {
    [paramKey: string]: number | boolean | string | Promise<number | boolean | string>;
}

export interface IDatabaseConnector {
    Open(): void;
    // tslint:disable-next-line no-any
    Get(sql: string, parameters?: ISqlCommandParameters): Promise<any>;
    // tslint:disable-next-line no-any
    All(sql: string, parameters?: ISqlCommandParameters): Promise<any[]>;
    // tslint:disable-next-line no-any
    Run(sql: string, parameters?: ISqlCommandParameters): Promise<any>;
    Close(): Promise<void>;
    // tslint:disable-next-line no-any
    Exec(sql: string): Promise<any>;
}
