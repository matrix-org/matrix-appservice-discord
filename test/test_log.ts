import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import * as Proxyquire from "proxyquire";
import * as RealLog from "../src/log";
Chai.use(ChaiAsPromised);
const expect = Chai.expect;

let created_logger = null;
let logger_closed = false;
let logged_messages = [];

const WinstonMock = {
    createLogger: (format, transports) => {
        return created_logger = {
            format,
            transports,
            close: () => {
                logger_closed = true;
            },
            silent: false,
            log: (type, ...msg) => {
                logged_messages = logged_messages.concat(msg);
            }
        };
    },
};

const Log = (Proxyquire("../src/log", {
    "winston": WinstonMock,
}).Log);

describe("Log", () => {

    beforeEach(() => {
        logger_closed = false;
        logged_messages = [];
    })

    describe("ConfigureBridge", () => {
        it("should pass if config is empty", () => {
            Log.ConfigureBridge({});
        });
        it("should set basic log options", () => {
            Log.ConfigureBridge({
                console: "warn",
                lineDateFormat: "HH:mm:ss"
            });
            expect(Log.config.console).to.equal("warn");
            expect(Log.config.lineDateFormat).to.equal("HH:mm:ss");
            expect(Log.config.files).to.be.empty;
        });
        it("should setup file logging", () => {
            Log.ConfigureBridge({
                files: [
                    {
                        file: "./logfile.log"
                    }
                ]
            });
            expect(Log.config.files).to.not.be.empty;
            expect(Log.config.files[0].file).to.equal("./logfile.log");
        });
    });
    describe("ForceSilent", () => {
        it("should be silent", () => {
            Log.ForceSilent();
            expect(created_logger.silent).to.be.true;
            expect(logged_messages).to.contain("Log set to silent");
        });
    });
    describe("instance", () => {
        it("should log without configuring", () => {
            new Log("test").info("hi");
            expect(logged_messages).to.contain("hi");
        });
    });
})