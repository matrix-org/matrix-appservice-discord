import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import * as log from "npmlog";
import * as Discord from "discord.js";
import * as Proxyquire from "proxyquire";

// import * as Proxyquire from "proxyquire";
import { ThirdPartyHandler } from "../src/thirdpartyhandler";
import { DiscordBot } from "../src/bot";
import { MockGuild } from "./mocks/guild";
import { MockChannel } from "./mocks/channel";
import { MockCollection } from "./mocks/collection";
import { MockMember } from "./mocks/member";
import { DiscordBridgeConfig } from "../src/config";

Chai.use(ChaiAsPromised);
const expect = Chai.expect;

const guilds = new MockCollection<string, MockGuild>();
guilds.set("g12345", new MockGuild("12345", [
    new MockChannel("c12345", null, "RealName"),
], "TestGuildName"));
const bot = {
    guilds,
};

const config = new DiscordBridgeConfig();

describe("ThirdPartyHandler", () => {
    describe("SearchChannels", () => {
        it("will find a channel with the correct name", () => {
            const handler = new ThirdPartyHandler(bot as any, config);
            const res = handler.SearchChannels("g12345", "RealName");
            expect(res).to.have.lengthOf(1);
        });
        it("will find a channel with the correct name with different case", () => {
            const handler = new ThirdPartyHandler(bot as any, config);
            const res = handler.SearchChannels("g12345", "realnAME");
            expect(res).to.have.lengthOf(1);
        });
        it("will find a channel with a # prefix", () => {
            const handler = new ThirdPartyHandler(bot as any, config);
            const res = handler.SearchChannels("g12345", "#RealName");
            expect(res).to.have.lengthOf(1);
        });
        it("will not find a channel of a missing guild", () => {
            const handler = new ThirdPartyHandler(bot as any, config);
            const res = handler.SearchChannels("notarealguild", "RealName");
            expect(res).to.be.empty;
        });
        it("will not find a channel if the channel is missing", () => {
            const handler = new ThirdPartyHandler(bot as any, config);
            const res = handler.SearchChannels("notarealguild", "FakeName");
            expect(res).to.be.empty;
        });
    });
});
