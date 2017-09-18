import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import * as log from "npmlog";
import * as Discord from "discord.js";
import * as Proxyquire from "proxyquire";

// import * as Proxyquire from "proxyquire";
import { PresenceHandler } from "../src/presencehandler";
import { DiscordBot } from "../src/bot";
import { MockGuild } from "./mocks/guild";
import { MockMember } from "./mocks/member";

Chai.use(ChaiAsPromised);
const expect = Chai.expect;
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
                    }
                };
            }
        };
    }
};

describe("PresenceHandler", () => {
    describe("init", () => {
        it("constructor", () => {
            const handler = new PresenceHandler(<DiscordBot> bot);
        });
    });
    describe("Start", () => {
        it("should start without errors", () => {
            const handler = new PresenceHandler(<DiscordBot> bot);
            handler.Start(250);
        });
    });
    describe("Stop", () => {
        it("should stop without errors", () => {
            const handler = new PresenceHandler(<DiscordBot> bot);
            handler.Start(250);
            handler.Stop();
        });
    });
    describe("EnqueueMember", () => {
        it("adds a user properly", () => {
            const handler = new PresenceHandler(<DiscordBot> bot);
            handler.EnqueueMember(<any> new MockMember("abc","def"));
            handler.EnqueueMember(<any> new MockMember("abc","ghi"));
            Chai.assert.equal(handler.QueueCount, 2);
        });
        it("does not add duplicate users", () => {
            const handler = new PresenceHandler(<DiscordBot> bot);
            const member = <any> new MockMember("abc","def");
            handler.EnqueueMember(member);
            handler.EnqueueMember(member);
            Chai.assert.equal(handler.QueueCount, 1);
        });
    });
    describe("DequeueMember", () => {
        it("removes users properly", () => {
            const handler = new PresenceHandler(<DiscordBot> bot);
            const members = [
                <any> new MockMember("abc","def"),
                <any> new MockMember("abc","ghi"),
                <any> new MockMember("abc","wew"),
            ]
            handler.EnqueueMember(members[0]);
            handler.EnqueueMember(members[1]);
            handler.EnqueueMember(members[2]);

            handler.DequeueMember(members[2]);
            Chai.assert.equal(handler.QueueCount, 2);
            handler.DequeueMember(members[1]);
            Chai.assert.equal(handler.QueueCount, 1);
            handler.DequeueMember(members[0]);
            Chai.assert.equal(handler.QueueCount, 0);
        });
    });
    describe("ProcessMember", () => {
        it("processes an online user", () => {
            lastStatus = null;
            const handler = new PresenceHandler(<DiscordBot> bot);
            const member = <any> new MockMember("abc","def");
            member.MockSetPresence(new Discord.Presence({
                status: 'online',
            }));
            handler.ProcessMember(member);
            Chai.assert.deepEqual(lastStatus, {
                presence: "online",
            });
        });
        it("processes an offline user", () => {
            lastStatus = null;
            const handler = new PresenceHandler(<DiscordBot> bot);
            const member = <any> new MockMember("abc","def");
            member.MockSetPresence(new Discord.Presence({
                status: 'offline',
            }));
            handler.ProcessMember(member);
            Chai.assert.deepEqual(lastStatus, {
                presence: "offline",
            });

        });
        it("processes an idle user", () => {
            lastStatus = null;
            const handler = new PresenceHandler(<DiscordBot> bot);
            const member = <any> new MockMember("abc","def");
            member.MockSetPresence(new Discord.Presence({
                status: 'idle',
            }));
            handler.ProcessMember(member);
            Chai.assert.deepEqual(lastStatus, {
                presence: "unavailable",
            });
        });
        it("processes an dnd user", () => {
            lastStatus = null;
            const handler = new PresenceHandler(<DiscordBot> bot);
            const member = <any> new MockMember("abc","def");
            member.MockSetPresence(new Discord.Presence({
                status: 'dnd',
            }));
            handler.ProcessMember(member);
            Chai.assert.deepEqual(lastStatus, {
                presence: "online",
                status_msg: "Do not disturb",
            });
            member.MockSetPresence(new Discord.Presence({
                status: 'dnd',
                game: new Discord.Game({name:"Test Game"}),
            }));
            handler.ProcessMember(member);
            Chai.assert.deepEqual(lastStatus, {
                presence: "online",
                status_msg: "Do not disturb | Playing Test Game",
            });
        });
        it("processes a user playing games", () => {
            lastStatus = null;
            const handler = new PresenceHandler(<DiscordBot> bot);
            const member = <any> new MockMember("abc","def");
            member.MockSetPresence(new Discord.Presence({
                status: 'online',
                game: new Discord.Game({name:"Test Game"}),
            }));
            handler.ProcessMember(member);
            Chai.assert.deepEqual(lastStatus, {
                presence: "online",
                status_msg: "Playing Test Game",
            });
            member.MockSetPresence(new Discord.Presence({
                status: 'online',
                game: new Discord.Game({name:"Test Game", type: 1}),
            }));
            handler.ProcessMember(member);
            Chai.assert.deepEqual(lastStatus, {
                presence: "online",
                status_msg: "Streaming Test Game",
            });
        });
    });
});
