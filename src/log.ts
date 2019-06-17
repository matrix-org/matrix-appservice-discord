/*
Copyright  2018 matrix-appservice-discord

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

import { createLogger, Logger, format, transports } from "winston";
import { DiscordBridgeConfigLogging, LoggingFile} from "./config";
import { inspect } from "util";
import "winston-daily-rotate-file";

const FORMAT_FUNC = format.printf((info) => {
    return `${info.timestamp} [${info.module}] ${info.level}: ${info.message}`;
});

export class Log {
    public static get level() {
        return this.logger.level;
    }

    public static set level(level) {
        this.logger.level = level;
    }

    public static Configure(config: DiscordBridgeConfigLogging) {
        // Merge defaults.
        Log.config = Object.assign(new DiscordBridgeConfigLogging(), config);
        Log.setupLogger();
    }

    public static ForceSilent() {
        new Log("Log").warn("Log set to silent");
        Log.logger.silent = true;
    }

    private static config: DiscordBridgeConfigLogging;
    private static logger: Logger;

    private static setupLogger() {
        if (Log.logger) {
            Log.logger.close();
        }
        const tsports: transports.StreamTransportInstance[] = Log.config.files.map((file) =>
            Log.setupFileTransport(file),
        );
        tsports.push(new transports.Console({
            level: Log.config.console,
        }));
        Log.logger = createLogger({
            format: format.combine(
                format.timestamp({
                    format: Log.config.lineDateFormat,
                }),
                format.colorize(),
                FORMAT_FUNC,
            ),
            transports: tsports,
        });
    }

    private static setupFileTransport(config: LoggingFile): transports.FileTransportInstance {
        config = Object.assign(new LoggingFile(), config);
        const filterOutMods = format((info, _) => {
            if (config.disabled.includes(info.module) &&
                config.enabled.length > 0 &&
                !config.enabled.includes(info.module)
            ) {
                return false;
            }
            return info;
        });

        const opts = {
            datePattern: config.datePattern,
            filename: config.file,
            format: format.combine(
                filterOutMods(),
                FORMAT_FUNC,
            ),
            level: config.level,
            maxFiles: config.maxFiles,
            maxSize: config.maxSize,
        };

        // tslint:disable-next-line no-any
        return new (transports as any).DailyRotateFile(opts);
    }

    public warning = this.warn;

    constructor(private module: string) { }

    // tslint:disable-next-line no-any
    public error(...msg: any[]) {
        this.log("error", msg);
    }

    // tslint:disable-next-line no-any
    public warn(...msg: any[]) {
        this.log("warn", msg);
    }

    // tslint:disable-next-line no-any
    public info(...msg: any[]) {
        this.log("info", msg);
    }

    // tslint:disable-next-line no-any
    public verbose(...msg: any[]) {
        this.log("verbose", msg);
    }

    // tslint:disable-next-line no-any
    public silly(...msg: any[]) {
        this.log("silly", msg);
    }

    // tslint:disable-next-line no-any
    private log(level: string, msg: any[]) {
        if (!Log.logger) {
            // We've not configured the logger yet, so create a basic one.
            Log.config = new DiscordBridgeConfigLogging();
            Log.setupLogger();
        }
        const msgStr = msg.map((item) => {
            return typeof(item) === "string" ? item : inspect(item);
        }).join(" ");

        Log.logger.log(level, msgStr, {module: this.module});
    }
}
