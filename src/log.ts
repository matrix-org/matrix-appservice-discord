import { createLogger, Logger, format, transports } from "winston"; 
import { DiscordBridgeConfigLogging } from "./config";
import { inspect } from "util"; 
import * as moment from "moment";

const formatFunc = format.printf(info => {
    return `${info.timestamp} [${info.module}] ${info.level}: ${info.message}`;
});

export class Log {
    private static config: DiscordBridgeConfigLogging;
    private static logger: Logger = null;

    constructor(private module: string) {
        
    }

    static get level() {
        return this.logger.level;
    }

    static set level(level) {
        this.logger.level = level;
    }

    public static ConfigureBridge(config: DiscordBridgeConfigLogging) {
        Log.config = config;
        //Log.logger = createLogger({
            
        //});
    }

    public static ForceSilent() {
        new Log("Log").warn("Log set to silent");
        Log.logger.silent = true;
    }

    static _now() {
        return moment().format(Log.config.lineDateFormat);
    }


    private log(level: string, msg: any[]) {
        if (Log.logger === null) {
            // We've not configured the logger yet, so create a basic one.
            Log.config = new DiscordBridgeConfigLogging();
            Log.logger = createLogger({
                format: format.combine(
                    format.timestamp({
                        format: Log._now,
                    }),
                    format.colorize(),
                    formatFunc,
                ),
                transports: [new transports.Console({
                    level: "info"
                })]
            });
        }
        const msgStr = msg.map((item) => {
            return typeof(item) === "string" ? item : inspect(item);
        }).join(" ");

        Log.logger.log(level, msgStr, {module: this.module});

    }

    public error(...msg: any[]) {
        this.log("error", msg);
    }


    public warn(...msg: any[]) {
        this.log("warn", msg);
    }

    public warning = this.warn;

    public info(...msg: any[]) {
        this.log("info", msg);
    }

    public verbose(...msg: any[]) {
        this.log("verbose", msg);
    }

    public silly(...msg: any[]) {
        this.log("silly", msg);
    }

}