import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import * as log from "npmlog";
import * as Discord from "discord.js";
import * as Proxyquire from "proxyquire";

// import * as Proxyquire from "proxyquire";
import { MessageProcessor, MessageProcessorOpts } from "../src/messageprocessor";
import { DiscordBot } from "../src/bot";
import { MockGuild } from "./mocks/guild";
import { MockMember } from "./mocks/member";

Chai.use(ChaiAsPromised);
const expect = Chai.expect;
log.level = "silly";

// const assert = Chai.assert;
const bot = {
    GetGuildEmoji: (guild: Discord.Guild, id: string): Promise<string> => {
        if (id === "3333333") {
            return Promise.resolve("mxc://image");
        } else {
            throw new Error("Emoji not found");
        }
    },
};

describe("MessageProcessor", () => {
    describe("init", () => {
        it("constructor", () => {
            const mp = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
        });
    });
    describe("FormatDiscordMessage", () => {
      it("processes plain text messages correctly", async () => {
        const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
        const msg = new Discord.Message(null, null, null);
        msg.embeds = [];
        msg.content = "Hello World!";
        const result = await processor.FormatDiscordMessage(msg);
        Chai.assert(result.body, "Hello World!");
        Chai.assert(result.formattedBody, "Hello World!");
      });
      it("processes markdown messages correctly.", async () => {
        const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
        const msg = new Discord.Message(null, null, null);
        msg.embeds = [];
        msg.content = "Hello *World*!";
        const result = await processor.FormatDiscordMessage(msg);
        Chai.assert.equal(result.body, "Hello *World*!");
        Chai.assert.equal(result.formattedBody, "<p>Hello <em>World</em>!</p>\n");
      });
    });
    describe("ReplaceMembers", () => {
        it("processes members missing from the guild correctly", () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
            const guild: any = new MockGuild("123", []);
            const channel = new Discord.TextChannel(guild, null);
            const msg = new Discord.Message(channel, null, null);
            let content = "Hello <@!12345>";
            content = processor.ReplaceMembers(content, msg);
            Chai.assert.equal(content, "Hello @_discord_12345:localhost");
        });
        it("processes members with usernames correctly", () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
            const guild: any = new MockGuild("123", []);
            guild._mockAddMember(new MockMember("12345", "TestUsername"));
            const channel = new Discord.TextChannel(guild, null);
            const msg = new Discord.Message(channel, null, null);
            let content = "Hello <@!12345>";
            content = processor.ReplaceMembers(content, msg);
            Chai.assert.equal(content, "Hello TestUsername");
        });
    });
    describe("ReplaceMembersPostmark", () => {
        it("processes members missing from the guild correctly", () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
            const guild: any = new MockGuild("123", []);
            const channel = new Discord.TextChannel(guild, null);
            const msg = new Discord.Message(channel, null, null);
            let content = "Hello &lt;@!12345&gt;";
            content = processor.ReplaceMembersPostmark(content, msg);
            Chai.assert.equal(content,
                "Hello <a href=\"https://matrix.to/#/@_discord_12345:localhost\">@_discord_12345:localhost</a>");
        });
        it("processes members with usernames correctly", () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
            const guild: any = new MockGuild("123", []);
            guild._mockAddMember(new MockMember("12345", "TestUsername"));
            const channel = new Discord.TextChannel(guild, null);
            const msg = new Discord.Message(channel, null, null);
            let content = "Hello &lt;@!12345&gt;";
            content = processor.ReplaceMembersPostmark(content, msg);
            Chai.assert.equal(content,
                "Hello <a href=\"https://matrix.to/#/@_discord_12345:localhost\">TestUsername</a>");
        });
    });
    describe("ReplaceChannels", () => {
        it("processes unknown channel correctly", () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
            const guild: any = new MockGuild("123", []);
            const channel = new Discord.TextChannel(guild, {id: "456", name: "TestChannel"});
            const msg = new Discord.Message(channel, null, null);
            let content = "Hello <#123456789>";
            content = processor.ReplaceChannels(content, msg);
            Chai.assert.equal(content, "Hello #123456789");
        });
        it("processes channels correctly", () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
            const guild: any = new MockGuild("123", []);
            const channel = new Discord.TextChannel(guild, {id: "456", name: "TestChannel"});
            guild.channels.set("456", channel);
            const msg = new Discord.Message(channel, null, null);
            let content = "Hello <#456>";
            content = processor.ReplaceChannels(content, msg);
            Chai.assert.equal(content, "Hello #TestChannel");
        });
    });
    describe("ReplaceChannelsPostmark", () => {
        it("processes unknown channel correctly", () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
            const guild: any = new MockGuild("123", []);
            const channel = new Discord.TextChannel(guild, {id: "456", name: "TestChannel"});
            const msg = new Discord.Message(channel, null, null);
            let content = "Hello &lt;#123456789&gt;";
            content = processor.ReplaceChannelsPostmark(content, msg);
            Chai.assert.equal(content,
                "Hello <a href=\"https://matrix.to/#/#_discord_123_123456789:localhost\">#123456789</a>");
        });
        it("processes channels correctly", () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
            const guild: any = new MockGuild("123", []);
            const channel = new Discord.TextChannel(guild, {id: "456", name: "TestChannel"});
            guild.channels.set("456", channel);
            const msg = new Discord.Message(channel, null, null);
            let content = "Hello &lt;#456&gt;";
            content = processor.ReplaceChannelsPostmark(content, msg);
            Chai.assert.equal(content,
                "Hello <a href=\"https://matrix.to/#/#_discord_123_456:localhost\">#TestChannel</a>");
        });
    });
    describe("ReplaceEmoji", () => {
        it("processes unknown emoji correctly", async () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
            const guild: any = new MockGuild("123", []);
            const channel = new Discord.TextChannel(guild, {id: "456", name: "TestChannel"});
            const msg = new Discord.Message(channel, null, null);
            let content = "Hello <:hello:123456789>";
            content = await processor.ReplaceEmoji(content, msg);
            Chai.assert.equal(content, "Hello <:hello:123456789>");
        });
        it("processes emoji correctly", async () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
            const guild: any = new MockGuild("123", []);
            const channel = new Discord.TextChannel(guild, {id: "456", name: "TestChannel"});
            guild.channels.set("456", channel);
            const msg = new Discord.Message(channel, null, null);
            let content = "Hello <:hello:3333333>";
            content = await processor.ReplaceEmoji(content, msg);
            Chai.assert.equal(content, "Hello :hello:");
        });
    });
    describe("ReplaceEmojiPostmark", () => {
        it("processes unknown emoji correctly", async () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
            const guild: any = new MockGuild("123", []);
            const channel = new Discord.TextChannel(guild, {id: "456", name: "TestChannel"});
            const msg = new Discord.Message(channel, null, null);
            let content = "Hello &lt;:hello:123456789&gt;";
            content = await processor.ReplaceEmojiPostmark(content, msg);
            Chai.assert.equal(content, "Hello &lt;:hello:123456789&gt;");
        });
        it("processes emoji correctly", async () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
            const guild: any = new MockGuild("123", []);
            const channel = new Discord.TextChannel(guild, {id: "456", name: "TestChannel"});
            guild.channels.set("456", channel);
            const msg = new Discord.Message(channel, null, null);
            let content = "Hello &lt;:hello:3333333&gt;";
            content = await processor.ReplaceEmojiPostmark(content, msg);
            Chai.assert.equal(content, "Hello <img alt=\"hello\" src=\"mxc://image\" style=\"height: 1em;\"/>");
        });
    });
    describe("FindMentionsInPlainBody", () => {
        it("processes mentioned username correctly", async () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
            const guild: any = new MockGuild("123", []);
            const members: Discord.GuildMember[] = [new Discord.GuildMember(guild, {
                user: {
                    username: "TestUsername",
                    id: "12345",
                    discriminator: "54321",
                },
            })];
            Chai.assert.equal(
                processor.FindMentionsInPlainBody("Hello TestUsername", members),
                "Hello <@!12345>",
            );
            Chai.assert.equal(
                processor.FindMentionsInPlainBody("Hello TestUsername#54321", members),
                "Hello <@!12345>",
            );
        });
        it("processes mentioned nickname correctly", async () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
            const guild: any = new MockGuild("123", []);
            const members: Discord.GuildMember[] = [new Discord.GuildMember(guild, {
                nick: "Test",
                user: {
                    username: "Test",
                    id: "54321",
                },
            }), new Discord.GuildMember(guild, {
                nick: "TestNickname",
                user: {
                    username: "TestUsername",
                    id: "12345",
                },
            })];
            Chai.assert.equal(processor.FindMentionsInPlainBody("Hello TestNickname", members), "Hello <@!12345>");
            Chai.assert.equal(processor.FindMentionsInPlainBody("TestNickname: Hello", members), "<@!12345>: Hello");
            Chai.assert.equal(processor.FindMentionsInPlainBody("TestNickname, Hello", members), "<@!12345>, Hello");
            Chai.assert.equal(processor.FindMentionsInPlainBody("TestNickname Hello", members), "<@!12345> Hello");
            Chai.assert.equal(processor.FindMentionsInPlainBody("testNicKName Hello", members), "<@!12345> Hello");
            Chai.assert.equal(
                processor.FindMentionsInPlainBody("I wish TestNickname was here", members),
                "I wish <@!12345> was here",
            );
            Chai.assert.equal(
                processor.FindMentionsInPlainBody("I wish TestNickname was here, TestNickname is cool", members),
                "I wish <@!12345> was here, <@!12345> is cool",
            );
            Chai.assert.equal(
                processor.FindMentionsInPlainBody("TestNickname was here with Test", members),
                "<@!12345> was here with <@!54321>",
            );
        });
        it("processes non-mentions correctly", async () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
            const guild: any = new MockGuild("123", []);
            const members: Discord.GuildMember[] = [new Discord.GuildMember(guild, {
                nick: "that",
                user: {
                    username: "TestUsername",
                    id: "12345",
                },
            }),
            new Discord.GuildMember(guild, {
                nick: "testingstring",
                user: {
                    username: "that",
                    id: "12345",
                },
            })];
            const msg = "Welcome thatman";
            const content = processor.FindMentionsInPlainBody(msg, members);
            Chai.assert.equal(content, "Welcome thatman");
        });
    });
    describe("InsertEmbeds", () => {
        it("processes titleless embeds properly", () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
            const msg = new Discord.Message(null, null, null);
            msg.embeds = [
                new Discord.MessageEmbed(msg, {
                    description: "TestDescription",
                }),
            ];
            const inContent = "";
            const content = processor.InsertEmbeds(inContent, msg);
            Chai.assert.equal(content, "\n\n----\nTestDescription");
        });
        it("processes urlless embeds properly", () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
            const msg = new Discord.Message(null, null, null);
            msg.embeds = [
                new Discord.MessageEmbed(msg, {
                    title: "TestTitle",
                    description: "TestDescription",
                }),
            ];
            const inContent = "";
            const content = processor.InsertEmbeds(inContent, msg);
            Chai.assert.equal(content, "\n\n----\n##### TestTitle\nTestDescription");
        });
        it("processes linked embeds properly", () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
            const msg = new Discord.Message(null, null, null);
            msg.embeds = [
                new Discord.MessageEmbed(msg, {
                    title: "TestTitle",
                    url: "testurl",
                    description: "TestDescription",
                }),
            ];
            const inContent = "";
            const content = processor.InsertEmbeds(inContent, msg);
            Chai.assert.equal(content, "\n\n----\n##### [TestTitle](testurl)\nTestDescription");
        });
        it("processes multiple embeds properly", () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
            const msg = new Discord.Message(null, null, null);
            msg.embeds = [
                new Discord.MessageEmbed(msg, {
                    title: "TestTitle",
                    url: "testurl",
                    description: "TestDescription",
                }),
                new Discord.MessageEmbed(msg, {
                    title: "TestTitle2",
                    url: "testurl2",
                    description: "TestDescription2",
                }),
            ];
            const inContent = "";
            const content = processor.InsertEmbeds(inContent, msg);
            Chai.assert.equal(
                content,
"\n\n----\n##### [TestTitle](testurl)\nTestDescription\n\n----\n##### [TestTitle2](testurl2)\nTestDescription2",
            );
        });
        it("inserts embeds properly", () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
            const msg = new Discord.Message(null, null, null);
            msg.embeds = [
                new Discord.MessageEmbed(msg, {
                    title: "TestTitle",
                    url: "testurl",
                    description: "TestDescription",
                }),
            ];
            const inContent = "Content that goes in the message";
            const content = processor.InsertEmbeds(inContent, msg);
            Chai.assert.equal(
                content,
`Content that goes in the message

----
##### [TestTitle](testurl)
TestDescription`,
            );
        });
    });
});
