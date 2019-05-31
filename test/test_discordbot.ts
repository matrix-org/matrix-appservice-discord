/*
Copyright 2017 - 2019 matrix-appservice-discord

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
import * as Proxyquire from "proxyquire";
import * as Discord from "discord.js";
import { Log } from "../src/log";

import { MockGuild } from "./mocks/guild";
import { MockMember } from "./mocks/member";
import { DiscordBot } from "../src/bot";
import { MockDiscordClient } from "./mocks/discordclient";
import { MockMessage } from "./mocks/message";
import { Util } from "../src/util";
import { MockChannel } from "./mocks/channel";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

const expect = Chai.expect;

const assert = Chai.assert;
// const should = Chai.should as any;

const mockBridge = {
    getIntentFromLocalpart: (localpart: string) => {
        return {
            sendTyping: (room: string, isTyping: boolean) => {
                return;
            },
        };
    },
    getRoomStore: () => {
        return {
            getEntriesByRemoteRoomData: async (data) => {
                if (data.discord_channel === "321") {
                    return [{
                        matrix: {
                            getId: () => "foobar:example.com",
                        },
                    }];
                }
                return [];
            },
        };
    },
    getUserStore: () => {
        return {};
    },
};

const modDiscordBot = Proxyquire("../src/bot", {
    "./clientfactory": require("./mocks/discordclientfactory"),
    "./util": {
        Util: {
            AsyncForEach: Util.AsyncForEach,
            DelayedPromise: Util.DelayedPromise,
            UploadContentFromUrl: async () => {
                return {mxcUrl: "uploaded"};
            },
        },
    },
});
describe("DiscordBot", () => {
    let discordBot;
    const config = {
        auth: {
            botToken: "blah",
        },
        bridge: {
            disablePresence: true,
            domain: "localhost",
        },
        limits: {
            discordSendDelay: 50,
        },
    };
    describe("run()", () => {
        it("should resolve when ready.", async () => {
            discordBot = new modDiscordBot.DiscordBot(
                "",
                config,
                mockBridge,
                {},
            );
            await discordBot.run();
        });
    });

    describe("LookupRoom()", () => {
        beforeEach( async () => {
            discordBot = new modDiscordBot.DiscordBot(
                "",
                config,
                mockBridge,
                {},
            );
            await discordBot.run();
        });
        it("should reject a missing guild.", async () => {
            try {
                await discordBot.LookupRoom("541", "321");
                throw new Error("didn't fail");
            } catch (e) {
                expect(e.message).to.not.equal("didn't fail");
            }
        });

        it("should reject a missing channel.", async () => {
            try {
                await discordBot.LookupRoom("123", "666");
                throw new Error("didn't fail");
            } catch (e) {
                expect(e.message).to.not.equal("didn't fail");
            }
        });

        it("should resolve a guild and channel id.", async () => {
            await discordBot.LookupRoom("123", "321");
        });
    });
    describe("OnMessage()", () => {
        let SENT_MESSAGE = false;
        let HANDLE_COMMAND = false;
        let ATTACHMENT = {} as any;
        let MSGTYPE = "";
        function getDiscordBot() {
            SENT_MESSAGE = false;
            HANDLE_COMMAND = false;
            ATTACHMENT = {};
            MSGTYPE = "";
            const discord = new modDiscordBot.DiscordBot(
                "",
                config,
                mockBridge,
                {},
            );
            discord.bot = { user: { id: "654" } };
            discord.GetIntentFromDiscordMember = (_) => {return {
                sendMessage: async (room, msg) => {
                    SENT_MESSAGE = true;
                    if (msg.info) {
                        ATTACHMENT = msg.info;
                    }
                    MSGTYPE = msg.msgtype;
                    return {
                        event_id: "$fox:localhost",
                    };
                },
            }; };
            discord.userSync = {
                OnUpdateUser: async (user) => { },
            };
            discord.channelSync = {
                GetRoomIdsFromChannel: async (chan) => ["!asdf:localhost"],
            };
            discord.discordCommandHandler = {
                Process: async (msg) => { HANDLE_COMMAND = true; },
            };
            discord.store = {
                Insert: async (_) => { },
            };
            return discord;
        }
        it("ignores own messages", async () => {
            discordBot = getDiscordBot();
            const guild: any = new MockGuild("123", []);
            const author = new MockMember("654", "TestUsername");
            guild._mockAddMember(author);
            const channel = new Discord.TextChannel(guild, {} as any);
            const msg = new MockMessage(channel) as any;
            msg.author = author;
            msg.content = "Hi!";
            await discordBot.OnMessage(msg);
            Chai.assert.equal(SENT_MESSAGE, false);
        });
        it("Passes on !matrix commands", async () => {
            discordBot = getDiscordBot();
            const channel = new Discord.TextChannel({} as any, {} as any);
            const msg = new MockMessage(channel) as any;
            msg.content = "!matrix test";
            await discordBot.OnMessage(msg);
            Chai.assert.equal(HANDLE_COMMAND, true);
        });
        it("skips empty messages", async () => {
            discordBot = getDiscordBot();
            const channel = new Discord.TextChannel({} as any, {} as any);
            const msg = new MockMessage(channel) as any;
            msg.content = "";
            await discordBot.OnMessage(msg);
            Chai.assert.equal(SENT_MESSAGE, false);
        });
        it("sends normal messages", async () => {
            discordBot = getDiscordBot();
            const channel = new Discord.TextChannel({} as any, {} as any);
            const msg = new MockMessage(channel) as any;
            msg.content = "Foxies are amazing!";
            await discordBot.OnMessage(msg);
            Chai.assert.equal(SENT_MESSAGE, true);
        });
        it("uploads images", async () => {
            discordBot = getDiscordBot();
            const channel = new Discord.TextChannel({} as any, {} as any);
            const msg = new MockMessage(channel) as any;
            msg.attachments.set("1234", {
                filename: "someimage.png",
                filesize: 42,
                height: 0,
                url: "asdf",
                width: 0,
            });
            await discordBot.OnMessage(msg);
            Chai.assert.equal(MSGTYPE, "m.image");
            Chai.assert.equal(ATTACHMENT.mimetype, "image/png");
        });
        it("uploads videos", async () => {
            discordBot = getDiscordBot();
            const channel = new Discord.TextChannel({} as any, {} as any);
            const msg = new MockMessage(channel) as any;
            msg.attachments.set("1234", {
                filename: "foxes.mov",
                filesize: 42,
                height: 0,
                url: "asdf",
                width: 0,
            });
            await discordBot.OnMessage(msg);
            Chai.assert.equal(MSGTYPE, "m.video");
            Chai.assert.equal(ATTACHMENT.mimetype, "video/quicktime");
        });
        it("uploads audio", async () => {
            discordBot = getDiscordBot();
            const channel = new Discord.TextChannel({} as any, {} as any);
            const msg = new MockMessage(channel) as any;
            msg.attachments.set("1234", {
                filename: "meow.mp3",
                filesize: 42,
                height: 0,
                url: "asdf",
                width: 0,
            });
            await discordBot.OnMessage(msg);
            Chai.assert.equal(MSGTYPE, "m.audio");
            Chai.assert.equal(ATTACHMENT.mimetype, "audio/mpeg");
        });
        it("uploads other files", async () => {
            discordBot = getDiscordBot();
            const channel = new Discord.TextChannel({} as any, {} as any);
            const msg = new MockMessage(channel) as any;
            msg.attachments.set("1234", {
                filename: "meow.zip",
                filesize: 42,
                height: 0,
                url: "asdf",
                width: 0,
            });
            await discordBot.OnMessage(msg);
            Chai.assert.equal(MSGTYPE, "m.file");
            Chai.assert.equal(ATTACHMENT.mimetype, "application/zip");
        });
    });
    describe("OnMessageUpdate()", () => {
        it("should return on an unchanged message", async () => {
            discordBot = new modDiscordBot.DiscordBot(
                "",
                config,
                mockBridge,
                {},
            );

            const guild: any = new MockGuild("123", []);
            guild._mockAddMember(new MockMember("12345", "TestUsername"));
            const channel = new Discord.TextChannel(guild, {} as any);
            const oldMsg = new MockMessage(channel) as any;
            const newMsg = new MockMessage(channel) as any;
            oldMsg.embeds = [];
            newMsg.embeds = [];

            // Content updated but not changed
            oldMsg.content = "a";
            newMsg.content = "a";

            // Mock the SendMatrixMessage method to check if it is called
            let checkMsgSent = false;
            discordBot.SendMatrixMessage = (...args) => checkMsgSent = true;

            await discordBot.OnMessageUpdate(oldMsg, newMsg);
            Chai.assert.equal(checkMsgSent, false);
        });
        it("should send a matrix message on an edited discord message", async () => {
            discordBot = new modDiscordBot.DiscordBot(
                "",
                config,
                mockBridge,
                {},
            );
            discordBot.store.Get = (a, b) => null;

            const guild: any = new MockGuild("123", []);
            guild._mockAddMember(new MockMember("12345", "TestUsername"));
            const channel = new Discord.TextChannel(guild, {} as any);
            const oldMsg = new MockMessage(channel) as any;
            const newMsg = new MockMessage(channel) as any;
            oldMsg.embeds = [];
            newMsg.embeds = [];

            // Content updated and edited
            oldMsg.content = "a";
            newMsg.content = "b";

            // Mock the SendMatrixMessage method to check if it is called
            let checkMsgSent = false;
            discordBot.SendMatrixMessage = (...args) => checkMsgSent = true;

            await discordBot.OnMessageUpdate(oldMsg, newMsg);
            Chai.assert.equal(checkMsgSent, true);
        });
        it("should delete and re-send if it is the newest message", async () => {
            discordBot = new modDiscordBot.DiscordBot(
                "",
                config,
                mockBridge,
                {},
            );
            discordBot.store.Get = (a, b) => { return {
                MatrixId: "$event:localhost;!room:localhost",
                Next: () => true,
                Result: true,
            }; };
            discordBot.lastEventIds["!room:localhost"] = "$event:localhost";

            const guild: any = new MockGuild("123", []);
            guild._mockAddMember(new MockMember("12345", "TestUsername"));
            const channel = new Discord.TextChannel(guild, {} as any);
            const oldMsg = new MockMessage(channel) as any;
            const newMsg = new MockMessage(channel) as any;
            oldMsg.embeds = [];
            newMsg.embeds = [];

            // Content updated and edited
            oldMsg.content = "a";
            newMsg.content = "b";

            let deletedMessage = false;
            discordBot.DeleteDiscordMessage = async (_) => { deletedMessage = true; };
            let sentMessage = false;
            discordBot.OnMessage = async (_) => { sentMessage = true; };

            await discordBot.OnMessageUpdate(oldMsg, newMsg);
            Chai.assert.equal(deletedMessage, true);
            Chai.assert.equal(sentMessage, true);
        });
    });
    describe("event:message", () => {
        it("should delay messages so they arrive in order", async () => {
            discordBot = new modDiscordBot.DiscordBot(
                "",
                config,
                mockBridge,
                {},
            );
            let expected = 0;
            discordBot.OnMessage = async (msg: any) => {
                assert.equal(msg.n, expected);
                expected++;
            };
            const client: MockDiscordClient = (await discordBot.ClientFactory.getClient()) as MockDiscordClient;
            await discordBot.run();
            const ITERATIONS = 25;
            const CHANID = 123;
            // Send delay of 50ms, 2 seconds / 50ms - 5 for safety.
            for (let i = 0; i < ITERATIONS; i++) {
                await client.emit("message", { channel: { guild: { id: CHANID }, id: CHANID} });
            }
            await discordBot.discordMessageQueue[CHANID];
        });
        it("should handle messages that reject in the queue", async () => {
            discordBot = new modDiscordBot.DiscordBot(
                "",
                config,
                mockBridge,
                {},
            );
            let expected = 0;
            const THROW_EVERY = 5;
            discordBot.OnMessage = async (msg: any) => {
                assert.equal(msg.n, expected);
                expected++;
                if (expected % THROW_EVERY === 0) {
                    return Promise.reject("Deliberate throw in test");
                }
                return Promise.resolve();
            };
            const client: MockDiscordClient = (await discordBot.ClientFactory.getClient()) as MockDiscordClient;
            await discordBot.run();
            const ITERATIONS = 25;
            const CHANID = 123;
            // Send delay of 50ms, 2 seconds / 50ms - 5 for safety.
            for (let n = 0; n < ITERATIONS; n++) {
                await client.emit("message", { n, channel: { guild: { id: CHANID }, id: CHANID} });
            }
            await discordBot.discordMessageQueue[CHANID];
            assert.equal(expected, ITERATIONS);
        });
    });
    describe("locks", () => {
        it("should lock and unlock a channel", async () => {
            const bot = new modDiscordBot.DiscordBot(
                "",
                config,
                mockBridge,
                {},
            ) as DiscordBot;
            const chan = new MockChannel("123") as any;
            const t = Date.now();
            bot.lockChannel(chan);
            await bot.waitUnlock(chan);
            const diff = Date.now() - t;
            expect(diff).to.be.greaterThan(config.limits.discordSendDelay - 1);
        });
        it("should lock and unlock a channel early, if unlocked", async () => {
            const discordSendDelay = 500;
            const SHORTDELAY = 100;
            const MINEXPECTEDDELAY = 95;
            const bot = new modDiscordBot.DiscordBot(
                "",
                {
                    bridge: {
                        domain: "localhost",
                    },
                    limits: {
                        discordSendDelay,
                    },
                },
                mockBridge,
                {},
            ) as DiscordBot;
            const chan = new MockChannel("123") as any;
            setTimeout(() => bot.unlockChannel(chan), SHORTDELAY);
            const t = Date.now();
            bot.lockChannel(chan);
            await bot.waitUnlock(chan);
            const diff = Date.now() - t;
            // Date accuracy can be off by a few ms sometimes.
            expect(diff).to.be.greaterThan(MINEXPECTEDDELAY);
        });
    });
  // });
    // describe("ProcessMatrixMsgEvent()", () => {
    //
    // });
    // describe("UpdateRoom()", () => {
    //
    // });
    // describe("UpdateUser()", () => {
    //
    // });
    // describe("UpdatePresence()", () => {
    //
    // });
    // describe("OnTyping()", () => {
    //   const discordBot = new modDiscordBot.DiscordBot(
    //     config,
    //   );
    //   discordBot.run();
    //   it("should reject an unknown room.", () => {
    //     return assert.isRejected(discordBot.OnTyping( {id: "512"}, {id: "12345"}, true));
    //   });
    //   it("should resolve a known room.", () => {
    //     return assert.isFulfilled(discordBot.OnTyping( {id: "321"}, {id: "12345"}, true));
    //   });
    // });
});
