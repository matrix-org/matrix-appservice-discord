import { createLogger, Logger, format, transports } from "winston";     
import { DiscordBridgeConfigLogging, LoggingFile} from "./config";
import { inspect } from "util"; 
import * as moment from "moment";
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
    private static logger: Logger = null;

    private static now() {
        return moment().format(Log.config.lineDateFormat);
    }

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
                    format: Log.now,
                }),
                format.colorize(),
                FORMAT_FUNC,
            ),
            transports: tsports,
        });
    }

    private static setupFileTransport(config: LoggingFile): transports.FileTransportInstance {
        config = Object.assign(new LoggingFile(), config);
        const filterOutMods = format((info, opts) => {
            if (config.disabled.includes(info.module) &&
                config.enabled.length > 0 &&
                !config.enabled.includes(info.module)
            ) {
                return false;
            }
            return info;
        });

        const opts = {
            filename: config.file,
            maxFiles: config.maxFiles,
            maxSize: config.maxSize,
            datePattern: config.datePattern,
            level: config.level,
            format: format.combine(
                filterOutMods(),
                FORMAT_FUNC,
            ),
        };

        return new (transports as any).DailyRotateFile(opts);
    }

    public warning = this.warn;

    constructor(private module: string) { }

    public error(...msg: any[]) {
        this.log("error", msg);
    }

    public warn(...msg: any[]) {
        this.log("warn", msg);
    }

    public info(...msg: any[]) {
        this.log("info", msg);
    }

    public verbose(...msg: any[]) {
        this.log("verbose", msg);
    }

    public silly(...msg: any[]) {
        this.log("silly", msg);
    }

    private log(level: string, msg: any[]) {
        if (Log.logger === null) {
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
