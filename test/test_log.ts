import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import * as Proxyquire from "proxyquire";
import * as RealLog from "../src/log";
Chai.use(ChaiAsPromised);
const expect = Chai.expect;

let createdLogger = null;
let loggerClosed = false;
let loggedMessages = [];

const WinstonMock = {
    createLogger: (format, transports) => {
        return createdLogger = {
            format,
            transports,
            close: () => {
                loggerClosed = true;
            },
            silent: false,
            log: (type, ...msg) => {
                loggedMessages = loggedMessages.concat(msg);
            },
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
