import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import * as Proxyquire from "proxyquire";
import {DiscordBridgeConfig} from "../src/config";
import {MockDiscordClient} from "./mocks/discordclient";
import * as log from "npmlog";
import {PresenceHandler} from "../src/presencehandler";
import {DiscordBot} from "../src/bot";
import {MatrixRoomHandler} from "../src/matrixroomhandler";
import {MockChannel} from "./mocks/channel";
import {MockMember} from "./mocks/member";
import * as Bluebird from "bluebird";

Chai.use(ChaiAsPromised);
const expect = Chai.expect;

// const DiscordClientFactory = Proxyquire("../src/clientfactory", {
//     "discord.js": { Client: require("./mocks/discordclient").MockDiscordClient },
// }).DiscordClientFactory;

let USERSJOINED = 0;

function buildRequest(eventData) {
    if (eventData.unsigned === undefined) {
        eventData.unsigned = {age: 0};
    }
    return {
        getData: () => eventData,
    };
}

function createRH(opts: any = {}) {
    USERSJOINED = 0;
    const bot = {
        GetChannelFromRoomId: (roomid: string) => {
            if (roomid === "!accept:localhost") {
                const chan = new MockChannel();
                if (opts.createMembers) {
                    chan.members.set("12345", new MockMember("12345", "testuser1"));
                    chan.members.set("54321", new MockMember("54321", "testuser2"));
                    chan.members.set("bot12345", new MockMember("bot12345", "botuser"));
                }
                return Promise.resolve(chan);
            } else {
                return Promise.reject("Roomid not found");
            }
        },
        InitJoinUser: (member: MockMember, roomids: string[]) => {
                if (opts.failUser) {
                    return Promise.reject("test is rejecting joins");
                }
                USERSJOINED++;
                return Promise.resolve();

        },
        GetBotId: () => "bot12345",
        ProcessMatrixRedact: () => Promise.resolve("redacted"),
        ProcessMatrixMsgEvent: () => Promise.resolve("processed"),
    };
    const config = new DiscordBridgeConfig();
    config.limits.roomGhostJoinDelay = 0;
    if (opts.disableSS) {
        config.bridge.enableSelfServiceBridging = false;
    } else {
        config.bridge.enableSelfServiceBridging = true;
    }
    const mxClient = {
        getStateEvent: () => {
            return Promise.resolve(opts.powerLevels || {});
        },
    };
    const provisioner = null;
    const handler = new MatrixRoomHandler(bot as any, config, "@botuser:localhost", provisioner);
    handler.setBridge({
        getIntent: () => { return {
            sendMessage: (roomId, content) => Promise.resolve(content),
            getClient: () => mxClient,
        }; },
    });
    return handler;
}

describe("MatrixRoomHandler", () => {
    describe("OnAliasQueried", () => {
        it("should join successfully", () => {
            const handler = createRH();
            return expect(handler.OnAliasQueried("#accept:localhost", "!accept:localhost")).to.be.fulfilled;
        });
        it("should join successfully and create ghosts", () => {
            const EXPECTEDUSERS = 2;
            const TESTDELAY = 50;
            const handler = createRH({createMembers: true});
            return  handler.OnAliasQueried("#accept:localhost", "!accept:localhost").then(() => {
                return Bluebird.delay(TESTDELAY);
            }).then(() => {
                    expect(USERSJOINED).to.equal(EXPECTEDUSERS);
                    // test for something
                    return true;
            });
        });
        it("should not join successfully", () => {
            const handler = createRH();
            return expect(handler.OnAliasQueried("#reject:localhost", "!reject:localhost")).to.be.rejected;
        });
    });
    describe("OnEvent", () => {
        it("should reject old events", () => {
            const AGE = 900001; // 15 * 60 * 1000
            const handler = createRH();
            return expect(handler.OnEvent(
                buildRequest({unsigned: {age: AGE}}), null))
                .to.be.rejectedWith("Event too old");
        });
        it("should reject un-processable events", () => {
            const AGE = 900000; // 15 * 60 * 1000
            const handler = createRH();
            return expect(handler.OnEvent(buildRequest({
                content: {},
                type: "m.potato",
                unsigned: {age: AGE}}), null)).to.be.rejectedWith("Event not processed by bridge");
        });
        it("should handle invites", () => {
            const handler = createRH();
            handler.HandleInvite = (ev) => Promise.resolve("invited");
            return expect(handler.OnEvent(buildRequest({
                content: {membership: "invite"},
                type: "m.room.member"}), null)).to.eventually.equal("invited");
        });
        it("should ignore other member types", () => {
            const handler = createRH();
            handler.HandleInvite = (ev) => Promise.resolve("invited");
            return expect(handler.OnEvent(buildRequest({
                content: {membership: "join"},
                type: "m.room.member"}), null)).to.be.rejectedWith("Event not processed by bridge");
        });
        it("should handle redactions with existing rooms", () => {
            const handler = createRH();
            const context = {
                rooms: {
                    remote: true,
                },
            };
            return expect(handler.OnEvent(buildRequest({
                type: "m.room.redaction"}), context)).to.eventually.equal("redacted");
        });
        it("should ignore redactions with no linked room", () => {
            const handler = createRH();
            const context = {
                rooms: {
                    remote: null,
                },
            };
            return expect(handler.OnEvent(buildRequest({
                type: "m.room.redaction"}), context)).to.be.rejectedWith("Event not processed by bridge");
        });
        it("should process regular messages", () => {
            const handler = createRH();
            const context = {
                rooms: {
                    remote: {
                        roomId: "_discord_123_456",
                    },
                },
            };
            return expect(handler.OnEvent(buildRequest({
                type: "m.room.message", content: {body: "abc"}}), context)).to.eventually.equal("processed");
        });
        it("should process !discord commands", () => {
            const handler = createRH();
            handler.ProcessCommand = (ev) => Promise.resolve("processedcmd");
            return expect(handler.OnEvent(buildRequest({
                type: "m.room.message", content: {body: "!discord cmd"}}), null))
                .to.eventually.equal("processedcmd");
        });
        it("should ignore regular messages with no linked room", () => {
            const handler = createRH();
            const context = {
                rooms: {
                    remote: null,
                },
            };
            return expect(handler.OnEvent(buildRequest({
                type: "m.room.message", content: {body: "abc"}}), context))
                .to.be.rejectedWith("Event not processed by bridge");
        });
    });
    describe("HandleInvite", () => {
        it("should accept invite for bot user", () => {
            const handler: any = createRH();
            handler.joinRoom = () => Promise.resolve("joinedroom");
            return expect(handler.HandleInvite({
                state_key: "@botuser:localhost",
            })).to.eventually.be.equal("joinedroom");
        });
        it("should deny invite for other users", () => {
            const handler: any = createRH();
            handler.joinRoom = () => Promise.resolve("joinedroom");
            return expect(handler.HandleInvite({
                state_key: "@user:localhost",
            })).to.be.undefined;
        });
    });
    describe("ProcessCommand", () => {
        it("should warn if self service is disabled", () => {
            const handler: any = createRH({disableSS: true});
            return expect(handler.ProcessCommand({
                room_id: "!123:localhost",
            })).to.eventually.be.deep.equal({
                msgtype: "m.notice",
                body: "The owner of this bridge does not permit self-service bridging.",
            });
        });
        it("should warn if user is not powerful enough with defaults", () => {
            const handler: any = createRH();
            return expect(handler.ProcessCommand({
                room_id: "!123:localhost",
            })).to.eventually.be.deep.equal({
                msgtype: "m.notice",
                body: "You do not have the required power level in this room to create a bridge to a Discord channel.",
            });
        });
        it("should warn if user is not powerful enough with custom state default", () => {
            const handler: any = createRH({powerLevels: {
                state_default: 67,
            }});
            return expect(handler.ProcessCommand({
                room_id: "!123:localhost",
            })).to.eventually.be.deep.equal({
                msgtype: "m.notice",
                body: "You do not have the required power level in this room to create a bridge to a Discord channel.",
            });
        });
        it("should allow if user is powerful enough with defaults", () => {
            const handler: any = createRH({powerLevels: {
                    users_default: 60,
                }});
            return handler.ProcessCommand({
                room_id: "!123:localhost",
                content: {body: "!discord help"},
            }).then((evt) => {
                return expect(evt.body.startsWith("Available commands")).to.be.true;
            });
        });
        it("should allow if user is powerful enough with their own state", () => {
            const handler: any = createRH({powerLevels: {
                    users: {
                     "@user:localhost": 100,
                    },
                }});
            return handler.ProcessCommand({
                room_id: "!123:localhost",
                sender: "@user:localhost",
                content: {body: "!discord help"},
            }).then((evt) => {
                return expect(evt.body.startsWith("Available commands")).to.be.true;
            });
        });
        it("will not bridge if a link already exists", () => {
            const handler: any = createRH({powerLevels: {
                    users_default: 100,
                }});
            const context = {rooms: { remote: true }};
            return handler.ProcessCommand({
                room_id: "!123:localhost",
                content: {body: "!discord bridge"},
            }, context).then((evt) => {
                return expect(evt.body.startsWith("This room is already bridged to a Discord guild")).to.be.true;
            });
        });
    });
});
