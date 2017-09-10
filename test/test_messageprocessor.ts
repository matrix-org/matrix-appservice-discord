import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import * as log from "npmlog";
import * as Discord from "discord.js";
// import * as Proxyquire from "proxyquire";
import { MessageProcessor, MessageProcessorOpts } from "../src/messageprocessor";
import { MockGuild } from "./mocks/guild";
import { MockMember } from "./mocks/member";

Chai.use(ChaiAsPromised);
const expect = Chai.expect;
log.level = "silly";

// const assert = Chai.assert;

describe("MessageProcessor", () => {
    describe("init", () => {
        it("constructor", () => {
            new MessageProcessor(new MessageProcessorOpts("localhost"));
        });
    });
    describe("FormatDiscordMessage", () => {
      it("processes plain text messages correctly", () => {
        const processor = new MessageProcessor(new MessageProcessorOpts("localhost"));
        const msg = new Discord.Message(null,null,null);
        msg.content = "Hello World!";
        const result = processor.FormatDiscordMessage(msg);
        Chai.assert(result.body, "Hello World!");
        Chai.assert(result.formatted_body, "Hello World!");
      });
      it("processes markdown messages correctly.", () => {
        const processor = new MessageProcessor(new MessageProcessorOpts("localhost"));
        const msg = new Discord.Message(null,null,null);
        msg.content = "Hello *World*!";
        const result = processor.FormatDiscordMessage(msg);
        Chai.assert.equal(result.body, "Hello *World*!");
        Chai.assert.equal(result.formatted_body, "<p>Hello <em>World</em>!</p>\n");
      });
    });
    describe("ReplaceMembers", () => {
        it("processes members missing from the guild correctly", () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"));
            const guild :any = new MockGuild("123", []);
            const channel = new Discord.TextChannel(guild,null);
            const msg = new Discord.Message(channel,null,null);
            let content = "Hello <@!12345>";
            content = processor.ReplaceMembers(content, msg);
            Chai.assert.equal(content, "Hello @_discord_12345:localhost");
        });
        it("processes members with usernames correctly", () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"));
            const guild :any = new MockGuild("123", []);
            guild._mockAddMember(new MockMember("12345", "TestUsername"));
            const channel = new Discord.TextChannel(guild,null);
            const msg = new Discord.Message(channel,null,null);
            let content = "Hello <@!12345>";
            content = processor.ReplaceMembers(content, msg);
            Chai.assert.equal(content, "Hello TestUsername");
        });
    });
    describe("ReplaceChannels", () => {
        it("processes unknown channel correctly", () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"));
            const guild :any = new MockGuild("123", []);
            const channel = new Discord.TextChannel(guild,{id:"456", name:"TestChannel"});
            const msg = new Discord.Message(channel,null,null);
            let content = "Hello <#123456789>";
            content = processor.ReplaceChannels(content, msg);
            Chai.assert.equal(content, "Hello [#123456789](https://matrix.to/#/#_discord_123_123456789:localhost)");
        });
        it("processes channels correctly", () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"));
            const guild :any = new MockGuild("123", []);
            const channel = new Discord.TextChannel(guild,{id:"456", name:"TestChannel"});
            guild.channels.set("456", channel);
            const msg = new Discord.Message(channel,null,null);
            let content = "Hello <#456>";
            content = processor.ReplaceChannels(content, msg);
            Chai.assert.equal(content, "Hello [#TestChannel](https://matrix.to/#/#_discord_123_456:localhost)");
        });
    });
});
