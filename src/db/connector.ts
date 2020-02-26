/*
Copyright 2018, 2019 matrix-appservice-discord

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

type SQLTYPES = number | boolean | string | null;

export interface ISqlCommandParameters {
    [paramKey: string]: SQLTYPES | Promise<SQLTYPES>;
}

export interface ISqlRow {
    [key: string]: SQLTYPES;
}

export interface IDatabaseConnector {
    Open(): void;
    Get(sql: string, parameters?: ISqlCommandParameters): Promise<ISqlRow|null>;
    All(sql: string, parameters?: ISqlCommandParameters): Promise<ISqlRow[]>;
    Run(sql: string, parameters?: ISqlCommandParameters): Promise<void>;
    Close(): Promise<void>;
    Exec(sql: string): Promise<void>;
}
