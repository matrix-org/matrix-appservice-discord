import * as Chai from "chai";
import * as Proxyquire from "proxyquire";
import * as Discord from "discord.js";
import { Log } from "../src/log";

import { MockGuild } from "./mocks/guild";
import { MockMember } from "./mocks/member";
import { DiscordBot } from "../src/bot";
import { MockDiscordClient } from "./mocks/discordclient";
import { MockMessage } from "./mocks/message";

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
                config,
                null,
            );
            discordBot.setBridge(mockBridge);
            await discordBot.run();
        });
    });

    describe("LookupRoom()", () => {
        beforeEach( async () => {
            discordBot = new modDiscordBot.DiscordBot(
                config,
                null,
            );
            discordBot.setBridge(mockBridge);
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
    describe("OnMessageUpdate()", () => {
        it("should return on an unchanged message", async () => {
            discordBot = new modDiscordBot.DiscordBot(
                config,
                mockBridge,
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
                config,
                mockBridge,
            );

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
    });
    describe("event:message", () => {
        it("should delay messages so they arrive in order", async () => {
            discordBot = new modDiscordBot.DiscordBot(
                config,
                mockBridge,
            );
            let expected = 0;
            discordBot.OnMessage = async (msg: any) => {
                assert.equal(msg.n, expected);
                expected++;
            };
            const client: MockDiscordClient = (await discordBot.ClientFactory.getClient()) as MockDiscordClient;
            discordBot.setBridge(mockBridge);
            await discordBot.run();
            const ITERATIONS = 25;
            const CHANID = 123;
            // Send delay of 50ms, 2 seconds / 50ms - 5 for safety.
            for (let i = 0; i < ITERATIONS; i++) {
              await client.emit("message", { n: i, channel: { id: CHANID} });
            }
            await discordBot.discordMessageQueue[CHANID];
        });
        it("should handle messages that reject in the queue", async () => {
            discordBot = new modDiscordBot.DiscordBot(
                config,
                mockBridge,
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
            discordBot.setBridge(mockBridge);
            await discordBot.run();
            const ITERATIONS = 25;
            const CHANID = 123;
            // Send delay of 50ms, 2 seconds / 50ms - 5 for safety.
            for (let n = 0; n < ITERATIONS; n++) {
                await client.emit("message", { n, channel: { id: CHANID} });
            }
            await discordBot.discordMessageQueue[CHANID];
            assert.equal(expected, ITERATIONS);
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
    //   discordBot.setBridge(mockBridge);
    //   discordBot.run();
    //   it("should reject an unknown room.", () => {
    //     return assert.isRejected(discordBot.OnTyping( {id: "512"}, {id: "12345"}, true));
    //   });
    //   it("should resolve a known room.", () => {
    //     return assert.isFulfilled(discordBot.OnTyping( {id: "321"}, {id: "12345"}, true));
    //   });
    // });
    // describe("OnMessage()", () => {
    //
    // });
});
