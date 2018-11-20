import * as Chai from "chai";
import * as Discord from "discord.js";
import * as Proxyquire from "proxyquire";

import { PresenceHandler } from "../src/presencehandler";
import { DiscordBot } from "../src/bot";
import { MockGuild } from "./mocks/guild";
import { MockCollection } from "./mocks/collection";
import { MockMember } from "./mocks/member";
import { MockEmoji } from "./mocks/emoji";
import { MatrixEventProcessor, MatrixEventProcessorOpts } from "../src/matrixeventprocessor";
import { DiscordBridgeConfig } from "../src/config";
import { MockChannel } from "./mocks/channel";
import { IMatrixEvent } from "../src/matrixtypes";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

const expect = Chai.expect;
// const assert = Chai.assert;
const bot = {
    GetIntentFromDiscordMember: (member) => {
        return {
            getClient: () => {
                return {

                };
            },
        };
    },
};

const mxClient = {
    getStateEvent: async (roomId, stateType, stateKey) => {
        if (stateType === "m.room.member") {
            switch (stateKey) {
                case "@test:localhost":
                    return {
                        avatar_url: "mxc://localhost/avatarurl",
                        displayname: "Test User",
                    };
                case "@test_short:localhost":
                    return {
                        avatar_url: "mxc://localhost/avatarurl",
                        displayname: "t",
                    };
                case "@test_long:localhost":
                    return {
                        avatar_url: "mxc://localhost/avatarurl",
                        displayname: "this is a very very long displayname that should be capped",
                    };
            }
            return null;
        }
        return { };
    },
    mxcUrlToHttp: (url) => {
        return url.replace("mxc://", "https://");
    },
};

function createMatrixEventProcessor(
    disableMentions: boolean = false,
    disableEveryone = false,
    disableHere = false,
): MatrixEventProcessor {
    const bridge = {
        getBot: () => {
            return {
                isRemoteUser: () => false,
            };
        },
        getClientFactory: () => {
            return {
                getClientAs: () => {
                    return mxClient;
                },
            };
        },
        getIntent: () => {
            return {
                getClient: () => {
                    return {
                        getUserId: () => {
                            return "@botuser:localhost";
                        },
                    };
                },
                getEvent: async (_, eventId: string) => {
                    if (eventId === "$goodEvent:localhost") {
                        return {
                            content: {
                                body: "Hello!",
                            },
                            sender: "@doggo:localhost",
                        };
                    } else if (eventId === "$reply:localhost") {
                        return {
                            content: {
                                "body": `> <@doggo:localhost> This is the original body

                                This is the first reply`,
                                "formatted_body": `
<mx-reply><blockquote><a>In Reply to</a> <a>@doggo:localhost</a>
<br>This is the original body</blockquote></mx-reply>This is the first reply`,
                                "m.relates_to": {
                                    "m.in_reply_to": {
                                        event_id: "$goodEvent:localhost",
                                    },
                                },
                            },
                            sender: "@doggo:localhost",
                        };
                    } else if (eventId === "$nontext:localhost") {
                        return {
                            content: {
                                something: "not texty",
                            },
                            sender: "@doggo:localhost",
                        };
                    }
                    return null;
                },
                getProfileInfo: async (userId: string) => {
                    if (userId !== "@doggo:localhost") {
                        return null;
                    }
                    return {
                        avatar_url: "mxc://fakeurl.com",
                        displayname: "Doggo!",
                    };
                },
            };
        },
    };
    const config = new DiscordBridgeConfig();
    config.bridge.disableDiscordMentions = disableMentions;
    config.bridge.disableEveryoneMention = disableEveryone;
    config.bridge.disableHereMention = disableHere;

    const Util = Object.assign(require("../src/util").Util, {
        DownloadFile: (name: string) => {
            const size = parseInt(name.substring(name.lastIndexOf("/") + 1), undefined);
            return Buffer.alloc(size);
        },
    });

    return new (Proxyquire("../src/matrixeventprocessor", {
        "./util": {
            Util,
        },
    })).MatrixEventProcessor(
        new MatrixEventProcessorOpts(
            config,
            bridge,
            {} as any,
    ));
}
const mockChannel = new MockChannel();
mockChannel.members.set("12345", new MockMember("12345", "testuser2"));

describe("MatrixEventProcessor", () => {
    describe("StateEventToMessage", () => {
        it("Should ignore unhandled states", () => {
            const processor = createMatrixEventProcessor();
            const event = {
                sender: "@user:localhost",
                type: "m.room.nonexistant",
            } as IMatrixEvent;
            const channel = new MockChannel("123456");
            const msg = processor.StateEventToMessage(event, channel as any);
            Chai.assert.equal(msg, undefined);
        });
        it("Should ignore bot user states", () => {
            const processor = createMatrixEventProcessor();
            const event = {
                sender: "@botuser:localhost",
                type: "m.room.member",
            } as IMatrixEvent;
            const channel = new MockChannel("123456");
            const msg = processor.StateEventToMessage(event, channel as any);
            Chai.assert.equal(msg, undefined);
        });
        it("Should echo name changes", () => {
            const processor = createMatrixEventProcessor();
            const event = {
                content: {
                    name: "Test Name",
                },
                sender: "@user:localhost",
                type: "m.room.name",
            } as IMatrixEvent;
            const channel = new MockChannel("123456");
            const msg = processor.StateEventToMessage(event, channel as any);
            Chai.assert.equal(msg, "`@user:localhost` set the name to `Test Name` on Matrix.");
        });
        it("Should echo topic changes", () => {
            const processor = createMatrixEventProcessor();
            const event = {
                content: {
                    topic: "Test Topic",
                },
                sender: "@user:localhost",
                type: "m.room.topic",
            } as IMatrixEvent;
            const channel = new MockChannel("123456");
            const msg = processor.StateEventToMessage(event, channel as any);
            Chai.assert.equal(msg, "`@user:localhost` set the topic to `Test Topic` on Matrix.");
        });
        it("Should echo joins", () => {
            const processor = createMatrixEventProcessor();
            const event = {
                content: {
                    membership: "join",
                },
                sender: "@user:localhost",
                type: "m.room.member",
                unsigned: {},
            } as IMatrixEvent;
            const channel = new MockChannel("123456");
            const msg = processor.StateEventToMessage(event, channel as any);
            Chai.assert.equal(msg, "`@user:localhost` joined the room on Matrix.");
        });
        it("Should echo invites", () => {
            const processor = createMatrixEventProcessor();
            const event = {
                content: {
                    membership: "invite",
                },
                sender: "@user:localhost",
                state_key: "@user2:localhost",
                type: "m.room.member",
                unsigned: {},
            } as IMatrixEvent;
            const channel = new MockChannel("123456");
            const msg = processor.StateEventToMessage(event, channel as any);
            Chai.assert.equal(msg, "`@user:localhost` invited `@user2:localhost` to the room on Matrix.");
        });
        it("Should echo kicks", () => {
            const processor = createMatrixEventProcessor();
            const event = {
                content: {
                    membership: "leave",
                },
                sender: "@user:localhost",
                state_key: "@user2:localhost",
                type: "m.room.member",
                unsigned: {},
            } as IMatrixEvent;
            const channel = new MockChannel("123456");
            const msg = processor.StateEventToMessage(event, channel as any);
            Chai.assert.equal(msg, "`@user:localhost` kicked `@user2:localhost` from the room on Matrix.");
        });
        it("Should echo leaves", () => {
            const processor = createMatrixEventProcessor();
            const event = {
                content: {
                    membership: "leave",
                },
                sender: "@user:localhost",
                state_key: "@user:localhost",
                type: "m.room.member",
                unsigned: {},
            } as IMatrixEvent;
            const channel = new MockChannel("123456");
            const msg = processor.StateEventToMessage(event, channel as any);
            Chai.assert.equal(msg, "`@user:localhost` left the room on Matrix.");
        });
        it("Should echo bans", () => {
            const processor = createMatrixEventProcessor();
            const event = {
                content: {
                    membership: "ban",
                },
                sender: "@user:localhost",
                state_key: "@user2:localhost",
                type: "m.room.member",
                unsigned: {},
            } as IMatrixEvent;
            const channel = new MockChannel("123456");
            const msg = processor.StateEventToMessage(event, channel as any);
            Chai.assert.equal(msg, "`@user:localhost` banned `@user2:localhost` from the room on Matrix.");
        });
    });
    describe("EventToEmbed", () => {
        it("Should contain a profile.", async () => {
            const processor = createMatrixEventProcessor();
            const embeds = await processor.EventToEmbed({
                content: {
                    body: "testcontent",
                },
                sender: "@test:localhost",
            } as IMatrixEvent, mockChannel as any);
            const author = embeds.messageEmbed.author;
            Chai.assert.equal(author!.name, "Test User");
            Chai.assert.equal(author!.icon_url, "https://localhost/avatarurl");
            Chai.assert.equal(author!.url, "https://matrix.to/#/@test:localhost");
        });

        it("Should contain the users displayname if it exists.", async () => {
            const processor = createMatrixEventProcessor();
            const embeds = await processor.EventToEmbed({
                content: {
                    body: "testcontent",
                },
                sender: "@test:localhost",
            } as IMatrixEvent, mockChannel as any);
            const author = embeds.messageEmbed.author;
            Chai.assert.equal(author!.name, "Test User");
            Chai.assert.equal(author!.icon_url, "https://localhost/avatarurl");
            Chai.assert.equal(author!.url, "https://matrix.to/#/@test:localhost");
        });

        it("Should contain the users userid if the displayname is not set", async () => {
            const processor = createMatrixEventProcessor();
            const embeds = await processor.EventToEmbed({
                content: {
                    body: "testcontent",
                },
                sender: "@test_nonexistant:localhost",
            } as IMatrixEvent, mockChannel as any);
            const author = embeds.messageEmbed.author;
            Chai.assert.equal(author!.name, "@test_nonexistant:localhost");
            Chai.assert.isUndefined(author!.icon_url);
            Chai.assert.equal(author!.url, "https://matrix.to/#/@test_nonexistant:localhost");
        });

        it("Should use the userid when the displayname is too short", async () => {
            const processor = createMatrixEventProcessor();
            const embeds = await processor.EventToEmbed({
                content: {
                    body: "testcontent",
                },
                sender: "@test_short:localhost",
            } as IMatrixEvent, mockChannel as any);
            const author = embeds.messageEmbed.author;
            Chai.assert.equal(author!.name, "@test_short:localhost");
        });

        it("Should use the userid when displayname is too long", async () => {
            const processor = createMatrixEventProcessor();
            const embeds = await processor.EventToEmbed({
                content: {
                    body: "testcontent",
                },
                sender: "@test_long:localhost",
            } as IMatrixEvent, mockChannel as any);
            const author = embeds.messageEmbed.author;
            Chai.assert.equal(author!.name, "@test_long:localhost");
        });

        it("Should cap the sender name if it is too long", async () => {
            const processor = createMatrixEventProcessor();
            const embeds = await processor.EventToEmbed({
                content: {
                    body: "testcontent",
                },
                sender: "@testwithalottosayaboutitselfthatwillgoonandonandonandon:localhost",
            } as IMatrixEvent, mockChannel as any);
            const author = embeds.messageEmbed.author;
            Chai.assert.equal(author!.name, "@testwithalottosayaboutitselftha");
        });

        it("Should contain the users avatar if it exists.", async () => {
            const processor = createMatrixEventProcessor();
            const embeds = await processor.EventToEmbed({
                content: {
                    body: "testcontent",
                },
                sender: "@test:localhost",
            } as IMatrixEvent, mockChannel as any);
            const author = embeds.messageEmbed.author;
            Chai.assert.equal(author!.name, "Test User");
            Chai.assert.equal(author!.icon_url, "https://localhost/avatarurl");
            Chai.assert.equal(author!.url, "https://matrix.to/#/@test:localhost");
        });

        it("Should remove everyone mentions if configured.", async () => {
            const processor = createMatrixEventProcessor(false, true);
            const embeds = await processor.EventToEmbed({
                content: {
                    body: "@everyone Hello!",
                },
                sender: "@test:localhost",
            } as IMatrixEvent, mockChannel as any);
            Chai.assert.equal(embeds.messageEmbed.description, "@ everyone Hello!");
        });

        it("Should remove here mentions if configured.", async () => {
            const processor = createMatrixEventProcessor(false, false, true);
            const embeds = await processor.EventToEmbed({
                content: {
                    body: "@here Hello!",
                },
                sender: "@test:localhost",
            } as IMatrixEvent, mockChannel as any);
            Chai.assert.equal(embeds.messageEmbed.description, "@ here Hello!");
        });

        it("Should replace /me with * displayname, and italicize message", async () => {
            const processor = createMatrixEventProcessor();
            const embeds = await processor.EventToEmbed({
                content: {
                    body: "likes puppies",
                    msgtype: "m.emote",
                },
                sender: "@test:localhost",
            } as IMatrixEvent, mockChannel as any);
            Chai.assert.equal(
                embeds.messageEmbed.description,
                "_Test User likes puppies_",
            );
        });
        it("Should handle stickers.", async () => {
            const processor = createMatrixEventProcessor();
            const embeds = await processor.EventToEmbed({
                content: {
                    body: "Bunnies",
                    url: "mxc://bunny",
                },
                sender: "@test:localhost",
                type: "m.sticker",
            } as IMatrixEvent, mockChannel as any);
            Chai.assert.equal(embeds.messageEmbed.description, "");
        });
    });
    describe("HandleAttachment", () => {
        const SMALL_FILE = 200;
        it("message without an attachment", async () => {
            const processor = createMatrixEventProcessor();
            const ret = await processor.HandleAttachment({
                content: {
                    msgtype: "m.text",
                },
            } as IMatrixEvent, mxClient);
            expect(ret).equals("");
        });
        it("message without an info", async () => {
            const processor = createMatrixEventProcessor();
            const attachment = (await processor.HandleAttachment({
                content: {
                    body: "filename.webm",
                    msgtype: "m.video",
                    url: "mxc://localhost/200",
                },
            } as IMatrixEvent, mxClient)) as Discord.FileOptions;
            expect(attachment.name).to.eq("filename.webm");
            expect(attachment.attachment.length).to.eq(SMALL_FILE);
        });
        it("message without a url", async () => {
            const processor = createMatrixEventProcessor();
            const ret = await processor.HandleAttachment({
                content: {
                    info: {
                        size: 1,
                    },
                    msgtype: "m.video",
                },
            } as IMatrixEvent, mxClient);
            expect(ret).equals("");
        });
        it("message with a large info.size", async () => {
            const LARGE_FILE = 8000000;
            const processor = createMatrixEventProcessor();
            const ret = await processor.HandleAttachment({
                content: {
                    body: "filename.webm",
                    info: {
                        size: LARGE_FILE,
                    },
                    msgtype: "m.video",
                    url: "mxc://localhost/8000000",
                },
            } as IMatrixEvent, mxClient);
            expect(ret).equals("[filename.webm](https://localhost/8000000)");
        });
        it("message with a small info.size", async () => {
            const processor = createMatrixEventProcessor();
            const attachment = (await processor.HandleAttachment({
                content: {
                    body: "filename.webm",
                    info: {
                        size: SMALL_FILE,
                    },
                    msgtype: "m.video",
                    url: "mxc://localhost/200",
                },
            } as IMatrixEvent, mxClient)) as Discord.FileOptions;
            expect(attachment.name).to.eq("filename.webm");
            expect(attachment.attachment.length).to.eq(SMALL_FILE);
        });
        it("message with a small info.size but a larger file", async () => {
            const processor = createMatrixEventProcessor();
            const ret = await processor.HandleAttachment({
                content: {
                    body: "filename.webm",
                    info: {
                        size: 200,
                    },
                    msgtype: "m.video",
                    url: "mxc://localhost/8000000",
                },
            } as IMatrixEvent, mxClient);
            expect(ret).equals("[filename.webm](https://localhost/8000000)");
        });
        it("Should handle stickers.", async () => {
            const processor = createMatrixEventProcessor();
            const attachment = (await processor.HandleAttachment({
                content: {
                    body: "Bunnies",
                    info: {
                        mimetype: "image/png",
                    },
                    url: "mxc://bunny",
                },
                sender: "@test:localhost",
                type: "m.sticker",
            } as IMatrixEvent, mxClient)) as Discord.FileOptions;
            expect(attachment.name).to.eq("Bunnies.png");
        });
    });
    describe("GetEmbedForReply", () => {
        it("should handle reply-less events", async () => {
            const processor = createMatrixEventProcessor();
            const result = await processor.GetEmbedForReply({
                content: {
                    body: "Test",
                },
                sender: "@test:localhost",
                type: "m.room.message",
            } as IMatrixEvent, mockChannel as any);
            expect(result).to.be.undefined;
        });
        it("should handle replies without a fallback", async () => {
            const processor = createMatrixEventProcessor();
            const result = await processor.GetEmbedForReply({
                content: {
                    "body": "Test",
                    "m.relates_to": {
                        "m.in_reply_to": {
                            event_id: "$goodEvent:localhost",
                        },
                    },
                },
                sender: "@test:localhost",
                type: "m.room.message",
            } as IMatrixEvent, mockChannel as any);
            expect(result!.description).to.be.equal("Hello!");
            expect(result!.author!.name).to.be.equal("Doggo!");
            expect(result!.author!.icon_url).to.be.equal("https://fakeurl.com");
            expect(result!.author!.url).to.be.equal("https://matrix.to/#/@doggo:localhost");
        });
        it("should handle replies with a missing event", async () => {
            const processor = createMatrixEventProcessor();
            const result = await processor.GetEmbedForReply({
                content: {
                    "body": `> <@doggo:localhost> This is the fake body

This is where the reply goes`,
                    "m.relates_to": {
                        "m.in_reply_to": {
                            event_id: "$event:thing",
                        },
                    },
                },
                sender: "@test:localhost",
                type: "m.room.message",
            } as IMatrixEvent, mockChannel as any);
            expect(result!.description).to.be.equal("Reply with unknown content");
            expect(result!.author!.name).to.be.equal("Unknown");
            expect(result!.author!.icon_url).to.be.undefined;
            expect(result!.author!.url).to.be.undefined;
        });
        it("should handle replies with a valid reply event", async () => {
            const processor = createMatrixEventProcessor();
            const result = await processor.GetEmbedForReply({
                content: {
                    "body": `> <@doggo:localhost> This is the original body

This is where the reply goes`,
                    "m.relates_to": {
                        "m.in_reply_to": {
                            event_id: "$goodEvent:localhost",
                        },
                    },
                },
                sender: "@test:localhost",
                type: "m.room.message",
            } as IMatrixEvent, mockChannel as any);
            expect(result!.description).to.be.equal("Hello!");
            expect(result!.author!.name).to.be.equal("Doggo!");
            expect(result!.author!.icon_url).to.be.equal("https://fakeurl.com");
            expect(result!.author!.url).to.be.equal("https://matrix.to/#/@doggo:localhost");
        });
        it("should handle replies on top of replies", async () => {
            const processor = createMatrixEventProcessor();
            const result = await processor.GetEmbedForReply({
                content: {
                    "body": `> <@doggo:localhost> This is the first reply

This is the second reply`,
                    "m.relates_to": {
                        "m.in_reply_to": {
                            event_id: "$reply:localhost",
                        },
                    },
                },
                sender: "@test:localhost",
                type: "m.room.message",
            } as IMatrixEvent, mockChannel as any);
            expect(result!.description).to.be.equal("This is the first reply");
            expect(result!.author!.name).to.be.equal("Doggo!");
            expect(result!.author!.icon_url).to.be.equal("https://fakeurl.com");
            expect(result!.author!.url).to.be.equal("https://matrix.to/#/@doggo:localhost");
        });
        it("should handle replies with non text events", async () => {
            const processor = createMatrixEventProcessor();
            const result = await processor.GetEmbedForReply({
                content: {
                    "body": `> <@doggo:localhost> sent an image.

This is the reply`,
                    "m.relates_to": {
                        "m.in_reply_to": {
                            event_id: "$nontext:localhost",
                        },
                    },
                },
                sender: "@test:localhost",
                type: "m.room.message",
            } as IMatrixEvent, mockChannel as any);
            expect(result!.description).to.be.equal("Reply with unknown content");
            expect(result!.author!.name).to.be.equal("Doggo!");
            expect(result!.author!.icon_url).to.be.equal("https://fakeurl.com");
            expect(result!.author!.url).to.be.equal("https://matrix.to/#/@doggo:localhost");
        });
    });
});
