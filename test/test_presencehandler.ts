import * as Chai from "chai";
import * as Discord from "discord.js";
import * as Proxyquire from "proxyquire";

import { PresenceHandler } from "../src/presencehandler";
import { DiscordBot } from "../src/bot";
import { MockUser } from "./mocks/user";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

const expect = Chai.expect;
const INTERVAL = 250;
let lastStatus = null;
// const assert = Chai.assert;
const bot = {
    GetBotId: () => {
        return "1234";
    },
    GetIntentFromDiscordMember: (member) => {
        return {
            getClient: () => {
                return {
                    setPresence: async (status) => {
                        lastStatus = status;
                    },
                };
            },
        };
    },
};

describe("PresenceHandler", () => {
    describe("init", () => {
        it("constructor", () => {
            const handler = new PresenceHandler(bot as DiscordBot);
        });
    });
    describe("Stop", () => {
        it("should start and stop without errors", async () => {
            const handler = new PresenceHandler(bot as DiscordBot);
            await handler.Start(INTERVAL);
            handler.Stop();
        });
    });
    describe("EnqueueUser", () => {
        it("adds a user properly", () => {
            const handler = new PresenceHandler(bot as DiscordBot);
            const COUNT = 2;
            handler.EnqueueUser(new MockUser("abc", "def") as any);
            handler.EnqueueUser(new MockUser("123", "ghi") as any);
            Chai.assert.equal(handler.QueueCount, COUNT);
        });
        it("does not add duplicate users", () => {
            const handler = new PresenceHandler(bot as DiscordBot);
            handler.EnqueueUser(new MockUser("abc", "def") as any);
            handler.EnqueueUser(new MockUser("abc", "def") as any);
            Chai.assert.equal(handler.QueueCount, 1);
        });
        it("does not add the bot user", () => {
            const handler = new PresenceHandler(bot as DiscordBot);
            handler.EnqueueUser(new MockUser("1234", "def") as any);
            Chai.assert.equal(handler.QueueCount, 0);
        });
    });
    describe("DequeueUser", () => {
        it("removes users properly", () => {
            const handler = new PresenceHandler(bot as DiscordBot);
            const members = [
                new MockUser("abc", "def") as any,
                new MockUser("def", "ghi") as any,
                new MockUser("ghi", "wew") as any,
            ];
            handler.EnqueueUser(members[0]);
            handler.EnqueueUser(members[1]);
            handler.EnqueueUser(members[members.length - 1]);

            handler.DequeueUser(members[members.length - 1]);
            Chai.assert.equal(handler.QueueCount, members.length - 1);
            handler.DequeueUser(members[1]);
            Chai.assert.equal(handler.QueueCount, 1);
            handler.DequeueUser(members[0]);
            Chai.assert.equal(handler.QueueCount, 0);
        });
    });
    describe("ProcessUser", () => {
        it("processes an online user", async () => {
            lastStatus = null;
            const handler = new PresenceHandler(bot as DiscordBot);
            const member = new MockUser("abc", "def") as any;
            member.MockSetPresence(new Discord.Presence({
                status: "online",
            }, {} as any));
            await handler.ProcessUser(member);
            Chai.assert.deepEqual(lastStatus, {
                presence: "online",
            });
        });
        it("processes an offline user", async () => {
            lastStatus = null;
            const handler = new PresenceHandler(bot as DiscordBot);
            const member = new MockUser("abc", "def") as any;
            member.MockSetPresence(new Discord.Presence({
                status: "offline",
            }, {} as any));
            await handler.ProcessUser(member);
            Chai.assert.deepEqual(lastStatus, {
                presence: "offline",
            });

        });
        it("processes an idle user", async () => {
            lastStatus = null;
            const handler = new PresenceHandler(bot as DiscordBot);
            const member = new MockUser("abc", "def") as any;
            member.MockSetPresence(new Discord.Presence({
                status: "idle",
            }, {} as any));
            await handler.ProcessUser(member);
            Chai.assert.deepEqual(lastStatus, {
                presence: "unavailable",
            });
        });
        it("processes an dnd user", async () => {
            lastStatus = null;
            const handler = new PresenceHandler(bot as DiscordBot);
            const member = new MockUser("abc", "def") as any;
            member.MockSetPresence(new Discord.Presence({
                status: "dnd",
            }, {} as any));
            await handler.ProcessUser(member);
            Chai.assert.deepEqual(lastStatus, {
                presence: "online",
                status_msg: "Do not disturb",
            });
            member.MockSetPresence(new Discord.Presence({
                game: new Discord.Game({name: "Test Game"}, {} as any),
                status: "dnd",
            }, {} as any));
            await handler.ProcessUser(member);
            Chai.assert.deepEqual(lastStatus, {
                presence: "online",
                status_msg: "Do not disturb | Playing Test Game",
            });
        });
        it("processes a user playing games", async () => {
            lastStatus = null;
            const handler = new PresenceHandler(bot as DiscordBot);
            const member = new MockUser("abc", "def") as any;
            member.MockSetPresence(new Discord.Presence({
                game: new Discord.Game({name: "Test Game"}, {} as any),
                status: "online",
            }, {} as any));
            await handler.ProcessUser(member);
            Chai.assert.deepEqual(lastStatus, {
                presence: "online",
                status_msg: "Playing Test Game",
            });
            member.MockSetPresence(new Discord.Presence({
                game: new Discord.Game({name: "Test Game", type: 1}, {} as any),
                status: "online",
            }, {} as any));
            await handler.ProcessUser(member);
            Chai.assert.deepEqual(lastStatus, {
                presence: "online",
                status_msg: "Streaming Test Game",
            });
        });
    });
});
