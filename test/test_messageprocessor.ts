import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import * as Discord from "discord.js";
import { MessageProcessor, MessageProcessorOpts } from "../src/messageprocessor";
import { DiscordBot } from "../src/bot";
import { MockGuild } from "./mocks/guild";
import { MockMember } from "./mocks/member";

Chai.use(ChaiAsPromised);

const bot = {
    GetEmoji: (name: string, animated: boolean, id: string): Promise<string> => {
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
        Chai.assert.equal(result.formattedBody, "<p>Hello <em>World</em>!</p>");
      });
      it("processes non-discord markdown correctly.", async() => {
        const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
        const msg = new Discord.Message(null, null, null);
        msg.embeds = [];
        msg.content = "> inb4 tests";
        let result = await processor.FormatDiscordMessage(msg);
        Chai.assert.equal(result.body, "> inb4 tests");
        Chai.assert.equal(result.formattedBody, "<p>&gt; inb4 tests</p>");

        msg.embeds = [];
        msg.content = "[test](http://example.com)";
        result = await processor.FormatDiscordMessage(msg);
        Chai.assert.equal(result.body, "[test](http://example.com)");
        Chai.assert.equal(result.formattedBody, "<p>[test](<a href=\"http://example.com\">http://example.com</a>)</p>");
      });
      it("processes discord-specific markdown correctly.", async() => {
        const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
        const msg = new Discord.Message(null, null, null);
        msg.embeds = [];
        msg.content = "_ italic _";
        const result = await processor.FormatDiscordMessage(msg);
        Chai.assert.equal(result.body, "_ italic _");
        Chai.assert.equal(result.formattedBody, "<p><em> italic </em></p>");
      });
    });
    describe("FormatEmbeds", () => {
      it("should format embeds correctly", async () => {
        const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
        const msg = new Discord.Message(null, null, null);
        msg.embeds = [
            {
                author: null,
                client: null,
                color: null,
                createdAt: null,
                createdTimestamp: null,
                fields: null,
                footer: null,
                hexColor: null,
                image: null,
                message: null,
                provider: null,
                thumbnail: null,
                type: null,
                video: null,
                title: "Title",
                description: "Description",
                url: "http://example.com",
            },
        ];
        msg.content = "message";
        const result = await processor.FormatDiscordMessage(msg);
        Chai.assert.equal(result.body, "message\n\n----\n##### [Title](http://example.com)\nDescription");
        Chai.assert.equal(result.formattedBody, "<p>message</p><hr><h5><a href=\"http://example.com\">Title</a>" +
            "</h5><p>Description</p>");
      });
    });
    describe("FormatEdit", () => {
      it("should format basic edits appropriately", async () => {
        const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
        const oldMsg = new Discord.Message(null, null, null);
        const newMsg = new Discord.Message(null, null, null);
        oldMsg.embeds = [];
        newMsg.embeds = [];
       
        // Content updated but not changed
        oldMsg.content = "a";
        newMsg.content = "b";

        const result = await processor.FormatEdit(oldMsg, newMsg);
        Chai.assert.equal(result.body, "*edit:* ~~a~~ -> b");
        Chai.assert.equal(result.formattedBody, "<p><em>edit:</em> <del>a</del> -&gt; b</p>");
      });

      it("should format markdown heavy edits apropriately", async () => {
        const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
        const oldMsg = new Discord.Message(null, null, null);
        const newMsg = new Discord.Message(null, null, null);
        oldMsg.embeds = [];
        newMsg.embeds = [];
       
        // Content updated but not changed
        oldMsg.content = "a slice of **cake**";
        newMsg.content = "*a* slice of cake";

        const result = await processor.FormatEdit(oldMsg, newMsg);
        Chai.assert.equal(result.body, "*edit:* ~~a slice of **cake**~~ -> *a* slice of cake");
        Chai.assert.equal(result.formattedBody, "<p><em>edit:</em> <del>a slice of <strong>" +
          "cake</strong></del> -&gt; <em>a</em> slice of cake</p>");
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
        it("rejects titleless and descriptionless embeds", () => {
            const processor = new MessageProcessor(new MessageProcessorOpts("localhost"), <DiscordBot> bot);
            const msg = new Discord.Message(null, null, null);
            msg.embeds = [
                new Discord.MessageEmbed(msg, {
                    url: "testurl",
                }),
            ];
            const inContent = "Some content...";
            const content = processor.InsertEmbeds(inContent, msg);
            Chai.assert.equal(content, "Some content...");
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
