/*
Copyright 2018, 2019 matrix-appservice-discord

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

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

const TEST_TIMESTAMP = 1337;

const expect = Chai.expect;
// const assert = Chai.assert;
function buildRequest(eventData) {
    if (eventData.unsigned === undefined) {
        eventData.unsigned = {age: 0};
    }
    return {
        getData: () => eventData,
    };
}
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

let STATE_EVENT_MSG = "";
let USERSYNC_HANDLED = false;
let MESSAGE_PROCCESS = "";
let KICKBAN_HANDLED = false;

function createMatrixEventProcessor(): MatrixEventProcessor {
    USERSYNC_HANDLED = false;
    STATE_EVENT_MSG = "";
    MESSAGE_PROCCESS = "";
    KICKBAN_HANDLED = false;
    const bridge = {
        getBot: () => {
            return {
                isRemoteUser: (s) => s.includes("@_discord_"),
            };
        },
        getClientFactory: () => {
            return {
                _botUserId: "@botuser:localhost",
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
                            origin_server_ts: TEST_TIMESTAMP,
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
                    } else if (eventId === "$discord:localhost") {
                        return {
                            content: {
                                body: "Foxies",
                            },
                            sender: "@_discord_1234:localhost",
                        };
                    } else if (eventId === "$image:localhost") {
                        return {
                            content: {
                                body: "fox.jpg",
                                msgtype: "m.image",
                                url: "mxc://fox/localhost",
                            },
                            sender: "@fox:localhost",
                        };
                    } else if (eventId === "$file:localhost") {
                        return {
                            content: {
                                body: "package.zip",
                                msgtype: "m.file",
                                url: "mxc://package/localhost",
                            },
                            sender: "@fox:localhost",
                        };
                    }
                    return {
                        content: {},
                    };
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
    const us = {
        OnMemberState: async () => {
            USERSYNC_HANDLED = true;
        },
        OnUpdateUser: async () => { },
    };
    const config = new DiscordBridgeConfig();

    const Util = Object.assign(require("../src/util").Util, {
        DownloadFile: (name: string) => {
            const size = parseInt(name.substring(name.lastIndexOf("/") + 1), undefined);
            return Buffer.alloc(size);
        },
    });
    const discordbot = {
        GetBotId: () => "@botuser:localhost",
        GetChannelFromRoomId: async (roomId) => {
            return new MockChannel("123456");
        },
        GetDiscordUserOrMember: async (s) => {
            return new Discord.User({ } as any, { username: "Someuser" });
        },
        HandleMatrixKickBan: () => {
            KICKBAN_HANDLED = true;
        },
        ProcessMatrixRedact: async (evt) => {
            MESSAGE_PROCCESS = "redacted";
        },
        UserSyncroniser: us,
        sendAsBot: async (msg, channel, event) => {
            STATE_EVENT_MSG = msg;
        },
    };

    const ch = Object.assign(new (require("../src/matrixcommandhandler").MatrixCommandHandler)(bot as any, config), {
        HandleInvite: async (evt) => {
            MESSAGE_PROCCESS = "invited";
        },
        Process: async (evt) => {
            MESSAGE_PROCCESS = "command_processed";
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
            discordbot as any,
    ), ch);
}
const mockChannel = new MockChannel();
mockChannel.members.set("12345", new MockMember("12345", "testuser2"));

describe("MatrixEventProcessor", () => {
    describe("ProcessStateEvent", () => {
        it("Should ignore unhandled states", async () => {
            const processor = createMatrixEventProcessor();
            const event = {
                room_id: "!someroom:localhost",
                sender: "@user:localhost",
                type: "m.room.nonexistant",
            } as IMatrixEvent;
            await processor.ProcessStateEvent(event);
            expect(STATE_EVENT_MSG).to.equal("");
        });
        it("Should ignore bot user states", async () => {
            const processor = createMatrixEventProcessor();
            const event = {
                sender: "@botuser:localhost",
                type: "m.room.member",
            } as IMatrixEvent;
            await processor.ProcessStateEvent(event);
            expect(STATE_EVENT_MSG).to.equal("");
        });
        it("Should echo name changes", async () => {
            const processor = createMatrixEventProcessor();
            const event = {
                content: {
                    name: "Test Name",
                },
                sender: "@user:localhost",
                type: "m.room.name",
            } as IMatrixEvent;
            await processor.ProcessStateEvent(event);
            expect(STATE_EVENT_MSG).to.equal("`@user:localhost` set the name to `Test Name` on Matrix.");
        });
        it("Should echo topic changes", async () => {
            const processor = createMatrixEventProcessor();
            const event = {
                content: {
                    topic: "Test Topic",
                },
                sender: "@user:localhost",
                type: "m.room.topic",
            } as IMatrixEvent;
            await processor.ProcessStateEvent(event);
            expect(STATE_EVENT_MSG).to.equal("`@user:localhost` set the topic to `Test Topic` on Matrix.");
        });
        it("Should echo joins", async () => {
            const processor = createMatrixEventProcessor();
            const event = {
                content: {
                    membership: "join",
                },
                sender: "@user:localhost",
                type: "m.room.member",
                unsigned: {},
            } as IMatrixEvent;
            await processor.ProcessStateEvent(event);
            expect(STATE_EVENT_MSG).to.equal("`@user:localhost` joined the room on Matrix.");
        });
        it("Should echo invites", async () => {
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
            await processor.ProcessStateEvent(event);
            expect(STATE_EVENT_MSG).to.equal("`@user:localhost` invited `@user2:localhost` to the room on Matrix.");
        });
        it("Should echo kicks", async () => {
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
            await processor.ProcessStateEvent(event);
            expect(STATE_EVENT_MSG).to.equal("`@user:localhost` kicked `@user2:localhost` from the room on Matrix.");
        });
        it("Should echo leaves", async () => {
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
            await processor.ProcessStateEvent(event);
            expect(STATE_EVENT_MSG).to.equal("`@user:localhost` left the room on Matrix.");
        });
        it("Should echo bans", async () => {
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
            await processor.ProcessStateEvent(event);
            expect(STATE_EVENT_MSG).to.equal("`@user:localhost` banned `@user2:localhost` from the room on Matrix.");
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

        it("Should remove everyone mentions.", async () => {
            const processor = createMatrixEventProcessor();
            const embeds = await processor.EventToEmbed({
                content: {
                    body: "@everyone Hello!",
                },
                sender: "@test:localhost",
            } as IMatrixEvent, mockChannel as any);
            Chai.assert.equal(embeds.messageEmbed.description, "@\u200Beveryone Hello!");
        });

        it("Should remove here mentions.", async () => {
            const processor = createMatrixEventProcessor();
            const embeds = await processor.EventToEmbed({
                content: {
                    body: "@here Hello!",
                },
                sender: "@test:localhost",
            } as IMatrixEvent, mockChannel as any);
            Chai.assert.equal(embeds.messageEmbed.description, "@\u200Bhere Hello!");
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
        it("Should ping the user on discord replies", async () => {
            const processor = createMatrixEventProcessor();
            const embeds = await processor.EventToEmbed({
                content: {
                    "body": "Bunnies",
                    "m.relates_to": {
                        "m.in_reply_to": {
                            event_id: "$discord:localhost",
                        },
                    },
                    "url": "mxc://bunny",
                },
                sender: "@test:localhost",
                type: "m.room.member",
            } as IMatrixEvent, mockChannel as any);
            Chai.assert.equal(embeds.messageEmbed.description, "Bunnies\n(<@1234>)");
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
                    url: "mxc://bunny/500",
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
                room_id: "!fakeroom:localhost",
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
                room_id: "!fakeroom:localhost",
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
                room_id: "!fakeroom:localhost",
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
                room_id: "!fakeroom:localhost",
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
                room_id: "!fakeroom:localhost",
                sender: "@test:localhost",
                type: "m.room.message",
            } as IMatrixEvent, mockChannel as any);
            expect(result!.description).to.be.equal("Reply with unknown content");
            expect(result!.author!.name).to.be.equal("Doggo!");
            expect(result!.author!.icon_url).to.be.equal("https://fakeurl.com");
            expect(result!.author!.url).to.be.equal("https://matrix.to/#/@doggo:localhost");
        });
        it("should add the reply time", async () => {
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
                room_id: "!fakeroom:localhost",
                sender: "@test:localhost",
                type: "m.room.message",
            } as IMatrixEvent, mockChannel as any);
            // NOTE: Due to https://github.com/discordjs/discord.js/issues/3283, the typing is wrong here.
            expect(result!.timestamp!).to.be.equal(TEST_TIMESTAMP);
        });
        it("should add field for discord replies", async () => {
            const processor = createMatrixEventProcessor();
            const result = await processor.GetEmbedForReply({
                content: {
                    "body": "foxfoxfox",
                    "m.relates_to": {
                        "m.in_reply_to": {
                            event_id: "$discord:localhost",
                        },
                    },
                },
                room_id: "!fakeroom:localhost",
                sender: "@test:localhost",
                type: "m.room.message",
            } as IMatrixEvent, mockChannel as any);
            let foundField = false;
            for (const f of result!.fields!) {
                if (f.name === "ping") {
                    foundField = true;
                    expect(f.value).to.be.equal("<@1234>");
                    break;
                }
            }
            expect(foundField).to.be.true;
        });
        it("should handle replies to images", async () => {
            const processor = createMatrixEventProcessor();
            const result = await processor.GetEmbedForReply({
                content: {
                    "body": "Test",
                    "m.relates_to": {
                        "m.in_reply_to": {
                            event_id: "$image:localhost",
                        },
                    },
                },
                room_id: "!fakeroom:localhost",
                sender: "@test:localhost",
                type: "m.room.message",
            } as IMatrixEvent, mockChannel as any);
            expect(result!.image!.url!).to.be.equal("https://fox/localhost");
            expect(result!.description).to.be.equal("fox.jpg");
        });
        it("should handle replies to files", async () => {
            const processor = createMatrixEventProcessor();
            const result = await processor.GetEmbedForReply({
                content: {
                    "body": "Test",
                    "m.relates_to": {
                        "m.in_reply_to": {
                            event_id: "$file:localhost",
                        },
                    },
                },
                room_id: "!fakeroom:localhost",
                sender: "@test:localhost",
                type: "m.room.message",
            } as IMatrixEvent, mockChannel as any);
            expect(result!.description).to.be.equal("[package.zip](https://package/localhost)");
        });
    });
    describe("OnEvent", () => {
        it("should reject old events", async () => {
            const AGE = 900001; // 15 * 60 * 1000
            const processor = createMatrixEventProcessor();
            await processor.OnEvent(buildRequest({unsigned: {age: AGE}}), null);
            expect(MESSAGE_PROCCESS).equals("");
        });
        it("should reject un-processable events", async () => {
            const AGE = 900000; // 15 * 60 * 1000
            const processor = createMatrixEventProcessor();
            // check if nothing is thrown
            await processor.OnEvent(buildRequest({
                content: {},
                type: "m.potato",
                unsigned: {age: AGE}}), null);
            expect(MESSAGE_PROCCESS).equals("");
        });
        it("should handle own invites", async () => {
            const processor = createMatrixEventProcessor();
            await processor.OnEvent(buildRequest({
                content: {membership: "invite"},
                state_key: "@botuser:localhost",
                type: "m.room.member"}), null);
            expect(MESSAGE_PROCCESS).to.equal("invited");
        });
        it("should handle kicks to own members", async () => {
            const processor = createMatrixEventProcessor();
            await processor.OnEvent(buildRequest({
                content: {membership: "leave"},
                sender: "@badboy:localhost",
                state_key: "@_discord_12345:localhost",
                type: "m.room.member"}), null);
            expect(KICKBAN_HANDLED).to.be.true;
        });
        it("should handle bans to own members", async () => {
            const processor = createMatrixEventProcessor();
            await processor.OnEvent(buildRequest({
                content: {membership: "ban"},
                sender: "@badboy:localhost",
                state_key: "@_discord_12345:localhost",
                type: "m.room.member"}), null);
            expect(KICKBAN_HANDLED).to.be.true;
        });
        it("should pass other member types to state event", async () => {
            const processor = createMatrixEventProcessor();
            let stateevent = false;
            processor.ProcessStateEvent = async (ev) => {
                stateevent = true;
            };
            await processor.OnEvent(buildRequest({
                content: {membership: "join"},
                state_key: "@bacon:localhost",
                type: "m.room.member"}), null);
            expect(MESSAGE_PROCCESS).to.equal("");
            expect(stateevent).to.be.true;
        });
        it("should handle redactions with existing rooms", async () => {
            const processor = createMatrixEventProcessor();
            const context = {
                rooms: {
                    remote: true,
                },
            };
            await processor.OnEvent(buildRequest({
                type: "m.room.redaction"}), context);
            expect(MESSAGE_PROCCESS).equals("redacted");
        });
        it("should ignore redactions with no linked room", async () => {
            const processor = createMatrixEventProcessor();
            const context = {
                rooms: {
                    remote: null,
                },
            };
            await processor.OnEvent(buildRequest({
                    type: "m.room.redaction"}), context);
            expect(MESSAGE_PROCCESS).equals("");
        });
        it("should process regular messages", async () => {
            const processor = createMatrixEventProcessor();
            const context = {
                rooms: {
                    remote: {
                        roomId: "_discord_123_456",
                    },
                },
            };
            let processed = false;
            processor.ProcessMsgEvent = async (evt, _, __) => {
                processed = true;
            };
            await processor.OnEvent(buildRequest({
                content: {body: "abc"},
                type: "m.room.message",
            }), context);
            expect(MESSAGE_PROCCESS).to.equal("");
            expect(processed).to.be.true;
        });
        it("should alert if encryption is turned on", async () => {
            const processor = createMatrixEventProcessor();
            const context = {
                rooms: {
                    remote: {
                        roomId: "_discord_123_456",
                    },
                },
            };
            let encrypt = false;
            processor.HandleEncryptionWarning = async (evt) => {
                encrypt = true;
            };
            await processor.OnEvent(buildRequest({
                room_id: "!accept:localhost",
                type: "m.room.encryption",
            }), context);
            expect(encrypt).to.be.true;
        });
        it("should process !discord commands", async () => {
            const processor = createMatrixEventProcessor();
            await processor.OnEvent(buildRequest({
                content: {body: "!discord cmd"},
                type: "m.room.message",
            }), null);
            expect(MESSAGE_PROCCESS).to.equal("command_processed");
        });
        it("should ignore regular messages with no linked room", async () => {
            const processor = createMatrixEventProcessor();
            const context = {
                rooms: {
                    remote: null,
                },
            };
            await processor.OnEvent(buildRequest({
                content: {body: "abc"},
                type: "m.room.message",
            }), context);
            expect(MESSAGE_PROCCESS).equals("");
        });
        it("should process stickers", async () => {
            const processor = createMatrixEventProcessor();
            const context = {
                rooms: {
                    remote: {
                        roomId: "_discord_123_456",
                    },
                },
            };
            let processed = false;
            processor.ProcessMsgEvent = async (evt, _, __) => {
                processed = true;
            };
            await processor.OnEvent(buildRequest({
                content: {
                    body: "abc",
                    url: "mxc://abc",
                },
                type: "m.sticker",
            }), context);
            expect(processed).to.be.true;
        });
    });
});
