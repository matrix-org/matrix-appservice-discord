import * as Chai from "chai";
import * as Proxyquire from "proxyquire";
import * as RealLog from "../src/log";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

const expect = Chai.expect;

let createdLogger: any = null;
let loggerClosed: any = false;
let loggedMessages: any[] = [];

const WinstonMock = {
    createLogger: (format, transports) => {
        return createdLogger = {
            close: () => {
                loggerClosed = true;
            },
            format,
            log: (type, ...msg) => {
                loggedMessages = loggedMessages.concat(msg);
            },
            silent: false,
            transports,
        };
    },
};

const Log = (Proxyquire("../src/log", {
    winston: WinstonMock,
}).Log);

describe("Log", () => {

    beforeEach(() => {
        loggerClosed = false;
        loggedMessages = [];
    });

    describe("Configure", () => {
        it("should pass if config is empty", () => {
            Log.Configure({});
        });
        it("should set basic log options", () => {
            Log.Configure({
                console: "warn",
                lineDateFormat: "HH:mm:ss",
            });
            expect(Log.config.console).to.equal("warn");
            expect(Log.config.lineDateFormat).to.equal("HH:mm:ss");
            expect(Log.config.files).to.be.empty;
        });
        it("should setup file logging", () => {
            Log.Configure({
                files: [
                    {
                        file: "./logfile.log",
                    },
                ],
            });
            expect(Log.config.files).to.not.be.empty;
            expect(Log.config.files[0].file).to.equal("./logfile.log");
        });
    });
    describe("ForceSilent", () => {
        it("should be silent", () => {
            Log.ForceSilent();
            expect(createdLogger.silent).to.be.true;
            expect(loggedMessages).to.contain("Log set to silent");
        });
    });
    describe("instance", () => {
        it("should log without configuring", () => {
            new Log("test").info("hi");
            expect(loggedMessages).to.contain("hi");
        });
    });
});
