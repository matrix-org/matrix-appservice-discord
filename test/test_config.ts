import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import { DiscordBridgeConfig } from "../src/config";
Chai.use(ChaiAsPromised);
const expect = Chai.expect;


describe("DiscordBridgeConfig.ApplyConfig", () => {
    it("should merge configs correctly", () => {
        const config = new DiscordBridgeConfig();
        config.ApplyConfig({
            bridge: {
                homeserverUrl: "blah",
                disableTypingNotifications: true,
                disableDiscordMentions: false,
                disableDeletionForwarding: true,
                enableSelfServiceBridging: false
            },
            logging: {
                console: "warn",
            }
        });
        expect(config.bridge.homeserverUrl, "blah");
        expect(config.bridge.disableTypingNotifications).to.be.true;
        expect(config.bridge.disableDiscordMentions).to.be.false;
        expect(config.bridge.disableDeletionForwarding).to.be.true;
        expect(config.bridge.enableSelfServiceBridging).to.be.false;
        expect(config.logging.console, "warn");
    });
        it("should merge logging.files correctly", () => {
        const config = new DiscordBridgeConfig();
        config.ApplyConfig({
            logging: {
                console: "silent",
                files: [
                    {
                        file: "./bacon.log",
                    }
                ]
            }
        });
        expect(config.logging.files[0].file, "./bacon.log");
    });
})