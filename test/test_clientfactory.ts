import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import * as Proxyquire from "proxyquire";
import {DiscordBridgeConfigAuth} from "../src/config";
import {MockDiscordClient} from "./mocks/discordclient";
import * as log from "npmlog";

Chai.use(ChaiAsPromised);
const expect = Chai.expect;

const DiscordClientFactory = Proxyquire("../src/clientfactory", {
    "discord.js": { Client: require("./mocks/discordclient").MockDiscordClient },
}).DiscordClientFactory;

const STORE = {
    get_user_discord_ids: (userid: string) => {
        if (userid === "@valid:localhost") {
            return Promise.resolve(["12345"]);
        } else if (userid === "@invalid:localhost") {
            return Promise.resolve(["1234555"]);
        }
        return Promise.resolve([]);
    },
    get_token: (discordid: string) => {
        if (discordid === "12345") {
            return Promise.resolve("passme");
        } else if (discordid === "1234555") {
            return Promise.resolve("failme");
        }
        return Promise.reject("Token not found");
    },
};

describe("ClientFactory", () => {
    describe("init", () => {
       it ("should start successfully", () => {
           const config = new DiscordBridgeConfigAuth();
           config.botToken = "passme";
           const cf = new DiscordClientFactory(null, config);
           return expect(cf.init()).to.eventually.be.fulfilled;
       });
       it ("should fail if a config is not supplied", () => {
           log.level = "silent";
           const cf = new DiscordClientFactory(null);
           return expect(cf.init()).to.eventually.be.rejected;
       });
       it ("should fail if the bot fails to connect", () => {
           log.level = "silent";
           const config = new DiscordBridgeConfigAuth();
           config.botToken = "failme";
           const cf = new DiscordClientFactory(null, config);
           return expect(cf.init()).to.eventually.be.rejected;
       });
    });
    describe("getDiscordId", () => {
        it("should fetch id successfully", () => {
            const config = new DiscordBridgeConfigAuth();
            const cf = new DiscordClientFactory(null);
            return expect(cf.getDiscordId("passme")).to.eventually.equal("12345");
        });
        it("should fail if the token is not recognised", () => {
            log.level = "silent";
            const config = new DiscordBridgeConfigAuth();
            const cf = new DiscordClientFactory(null);
            return expect(cf.getDiscordId("failme")).to.eventually.be.rejected;
        });
    });
    describe("getClient", () => {
        it("should fetch bot client successfully", () => {
            const config = new DiscordBridgeConfigAuth();
            config.botToken = "passme";
            const cf = new DiscordClientFactory(null, config);
            cf.botClient = 1;
            return expect(cf.getClient()).to.eventually.equal(cf.botClient);
        });
        it("should return cached client", () => {
            log.level = "silent";
            const config = new DiscordBridgeConfigAuth();
            const cf = new DiscordClientFactory(null);
            cf.clients.set("@user:localhost", "testclient");
            return expect(cf.getClient("@user:localhost")).to.eventually.equal("testclient");
        });
        it("should fetch bot client if userid doesn't match", () => {
            log.level = "silent";
            const config = new DiscordBridgeConfigAuth();
            const cf = new DiscordClientFactory(STORE);
            cf.botClient = 1;
            return expect(cf.getClient("@user:localhost")).to.eventually.equal(cf.botClient);
        });
        it("should fetch user client if userid matches", () => {
            log.level = "silent";
            const config = new DiscordBridgeConfigAuth();
            const cf = new DiscordClientFactory(STORE);
            return cf.getClient("@valid:localhost").then((client) => {
                expect(client).is.not.null;
                expect(cf.clients.has("@valid:localhost")).to.be.true;
            });
        });
        it("should fail if the user client cannot log in", () => {
            log.level = "silent";
            const config = new DiscordBridgeConfigAuth();
            const cf = new DiscordClientFactory(STORE);
            cf.botClient = 1;
            return cf.getClient("@invalid:localhost").then((client) => {
                expect(client).to.equal(cf.botClient);
                expect(cf.clients.has("@invalid:localhost")).to.be.false;
            });
        });
    });
});
