export interface DatabaseConnector {
    Open(): void;
    Get(sql: string, parameters?: any): Promise<any>;
    All(sql: string, parameters?: any): Promise<any[]>;
    Run(sql: string, parameters?: any): Promise<any>;
    Close(): Promise<void>;
    Exec(sql: string): Promise<any>;
}
