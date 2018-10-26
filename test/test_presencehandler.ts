import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import * as Discord from "discord.js";
import * as Proxyquire from "proxyquire";

import { PresenceHandler } from "../src/presencehandler";
import { DiscordBot } from "../src/bot";
import { MockUser } from "./mocks/user";

Chai.use(ChaiAsPromised);
const expect = Chai.expect;
const INTERVAL = 250;
let lastStatus = null;
// const assert = Chai.assert;
const bot = {
    GetIntentFromDiscordMember: (member) => {
        return {
            getClient: () => {
                return {
                    setPresence: (status) => {
                        lastStatus = status;
                        return Promise.resolve();
                    },
                };
            },
        };
    },
    GetBotId: () => {
        return "1234";
    },
};

describe("PresenceHandler", () => {
    describe("init", () => {
        it("constructor", () => {
            const handler = new PresenceHandler(bot as DiscordBot);
        });
    });
    describe("Start", () => {
        it("should start without errors", () => {
            const handler = new PresenceHandler(bot as DiscordBot);
            handler.Start(INTERVAL);
        });
    });
    describe("Stop", () => {
        it("should stop without errors", () => {
            const handler = new PresenceHandler(bot as DiscordBot);
            handler.Start(INTERVAL);
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
        it("processes an online user", () => {
            lastStatus = null;
            const handler = new PresenceHandler(bot as DiscordBot);
            const member = new MockUser("abc", "def") as any;
            member.MockSetPresence(new Discord.Presence({
                status: "online",
            }));
            handler.ProcessUser(member);
            Chai.assert.deepEqual(lastStatus, {
                presence: "online",
            });
        });
        it("processes an offline user", () => {
            lastStatus = null;
            const handler = new PresenceHandler(bot as DiscordBot);
            const member = new MockUser("abc", "def") as any;
            member.MockSetPresence(new Discord.Presence({
                status: "offline",
            }));
            handler.ProcessUser(member);
            Chai.assert.deepEqual(lastStatus, {
                presence: "offline",
            });

        });
        it("processes an idle user", () => {
            lastStatus = null;
            const handler = new PresenceHandler(bot as DiscordBot);
            const member = new MockUser("abc", "def") as any;
            member.MockSetPresence(new Discord.Presence({
                status: "idle",
            }));
            handler.ProcessUser(member);
            Chai.assert.deepEqual(lastStatus, {
                presence: "unavailable",
            });
        });
        it("processes an dnd user", () => {
            lastStatus = null;
            const handler = new PresenceHandler(bot as DiscordBot);
            const member = new MockUser("abc", "def") as any;
            member.MockSetPresence(new Discord.Presence({
                status: "dnd",
            }));
            handler.ProcessUser(member);
            Chai.assert.deepEqual(lastStatus, {
                presence: "online",
                status_msg: "Do not disturb",
            });
            member.MockSetPresence(new Discord.Presence({
                status: "dnd",
                game: new Discord.Game({name: "Test Game"}),
            }));
            handler.ProcessUser(member);
            Chai.assert.deepEqual(lastStatus, {
                presence: "online",
                status_msg: "Do not disturb | Playing Test Game",
            });
        });
        it("processes a user playing games", () => {
            lastStatus = null;
            const handler = new PresenceHandler(bot as DiscordBot);
            const member = new MockUser("abc", "def") as any;
            member.MockSetPresence(new Discord.Presence({
                status: "online",
                game: new Discord.Game({name: "Test Game"}),
            }));
            handler.ProcessUser(member);
            Chai.assert.deepEqual(lastStatus, {
                presence: "online",
                status_msg: "Playing Test Game",
            });
            member.MockSetPresence(new Discord.Presence({
                status: "online",
                game: new Discord.Game({name: "Test Game", type: 1}),
            }));
            handler.ProcessUser(member);
            Chai.assert.deepEqual(lastStatus, {
                presence: "online",
                status_msg: "Streaming Test Game",
            });
        });
    });
});
