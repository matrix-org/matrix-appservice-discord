export interface IDatabaseConnector {
    Open(): void;
    // tslint:disable-next-line no-any
    Get(sql: string, parameters?: any): Promise<any>;
    // tslint:disable-next-line no-any
    All(sql: string, parameters?: any): Promise<any[]>;
    // tslint:disable-next-line no-any
    Run(sql: string, parameters?: any): Promise<any>;
    Close(): Promise<void>;
    // tslint:disable-next-line no-any
    Exec(sql: string): Promise<any>;
}
