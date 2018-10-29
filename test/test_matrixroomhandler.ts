import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import * as Proxyquire from "proxyquire";
import {DiscordBridgeConfig} from "../src/config";
import {MockDiscordClient} from "./mocks/discordclient";
import {PresenceHandler} from "../src/presencehandler";
import {DiscordBot} from "../src/bot";
import {MatrixRoomHandler} from "../src/matrixroomhandler";
import {MockChannel} from "./mocks/channel";
import {MockMember} from "./mocks/member";
import * as Bluebird from "bluebird";
import {MockGuild} from "./mocks/guild";
import {Guild} from "discord.js";
import { Util } from "../src/util";

Chai.use(ChaiAsPromised);
const expect = Chai.expect;

// const DiscordClientFactory = Proxyquire("../src/clientfactory", {
//     "discord.js": { Client: require("./mocks/discordclient").MockDiscordClient },
// }).DiscordClientFactory;

const RoomHandler = (Proxyquire("../src/matrixroomhandler", {
    "./util": {
        Util: {
            DelayedPromise: Util.DelayedPromise,
            MsgToArgs: Util.MsgToArgs,
            ParseCommand: Util.ParseCommand,
            GetMxidFromName: () => {
                return "@123456:localhost";
            },
        },
    },
})).MatrixRoomHandler;

let USERSJOINED = 0;
let USERSKICKED = 0;
let USERSBANNED = 0;
let USERSUNBANNED = 0;

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
    USERSKICKED = 0;
    USERSBANNED = 0;
    USERSUNBANNED = 0;
    const bridge = {
        getIntent: () => {
            return {
                sendMessage: (roomId, content) => Promise.resolve(content),
                getClient: () => mxClient,
                join: () => { USERSJOINED++; },
                leave: () => { },
                kick: () => { USERSKICKED++; return Promise.resolve(); },
                ban: () => { USERSBANNED++; return Promise.resolve(); },
                unban: () => { USERSUNBANNED++; return Promise.resolve(); },
            };
        },
        getBot: () => {
            return {
                isRemoteUser: (id) => {
                    return id !== undefined && id.startsWith("@_discord_");
                },
                getJoinedRooms: () => ["!123:localhost"],
            };
        },
        getRoomStore: () => {
            return {
                removeEntriesByMatrixRoomId: () => {

                },
            };
        },
    };
    const us = {
        OnMemberState: () => Promise.resolve("user_sync_handled"),
        OnUpdateUser: () => Promise.resolve(),
        EnsureJoin: () => Promise.resolve(),
    };
    const cs = {
        OnUpdate: () => Promise.resolve(),
        GetRoomIdsFromChannel: (chan) => {
            return Promise.resolve(["#" + chan.id + ":localhost"]);
        },
    };
    const bot = {
        GetChannelFromRoomId: (roomid: string) => {
            if (roomid === "!accept:localhost") {
                const guild = new MockGuild("666666");
                const chan = new MockChannel("777777", guild);
                if (opts.createMembers) {
                    chan.members.set("12345", new MockMember("12345", "testuser1"));
                    chan.members.set("54321", new MockMember("54321", "testuser2"));
                    chan.members.set("bot12345", new MockMember("bot12345", "botuser"));
                }
                guild.members = chan.members;
                return Promise.resolve(chan);
            } else {
                return Promise.reject("Roomid not found");
            }
        },
        GetBotId: () => "bot12345",
        ProcessMatrixRedact: () => Promise.resolve("redacted"),
        ProcessMatrixMsgEvent: () => Promise.resolve("processed"),
        ProcessMatrixStateEvent: () => Promise.resolve("stateevent"),
        LookupRoom: (guildid, discordid) => {
            if (guildid !== "123") {
                return Promise.reject("Guild not found");
            } else if (discordid !== "456") {
                return Promise.reject("Channel not found");
            }
            const channel = new MockChannel();
            return Promise.resolve({channel, botUser: true });
        },
        GetGuilds: () => [new MockGuild("123", [])],
        ThirdpartySearchForChannels: () => {
            return [];
        },
        GetIntentFromDiscordMember: () => {
            return bridge.getIntent();
        },
        UserSyncroniser: us,
        ChannelSyncroniser: cs,
    };
    const config = new DiscordBridgeConfig();
    config.limits.roomGhostJoinDelay = 0;
    if (opts.disableSS) {
        config.bridge.enableSelfServiceBridging = false;
    } else {
        config.bridge.enableSelfServiceBridging = true;
    }
    const mxClient = {
        joinRoom: () => {
            USERSJOINED++;
            return Promise.resolve();
        },
        getStateEvent: () => {
            return Promise.resolve(opts.powerLevels || {});
        },
        setRoomDirectoryVisibilityAppService: () => {
            return Promise.resolve();
        },
    };
    const provisioner = {
        AskBridgePermission: () => {
            return opts.denyBridgePermission ?
                Promise.reject(new Error("The bridge has been declined by the Discord guild")) : Promise.resolve();
        },
        BridgeMatrixRoom: () => {
            if (opts.failBridgeMatrix) {
                throw new Error("Test failed matrix bridge");
            }
        },
        UnbridgeRoom: () => {
            return opts.failUnbridge ?
                Promise.reject(new Error("Test failed unbridge")) : Promise.resolve();
        },
    };
    const handler = new RoomHandler(bot as any, config, "@botuser:localhost", provisioner as any);
    handler.setBridge(bridge);
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
            const handler = createRH({createMembers: true});
            return handler.OnAliasQueried("#accept:localhost", "!accept:localhost").then(() => {
                expect(USERSJOINED).to.equal(EXPECTEDUSERS);
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
        it("should handle own state updates", () => {
            const handler = createRH();
            return expect(handler.OnEvent(buildRequest({
                content: {membership: "join"},
                state_key: "@_discord_12345:localhost",
                type: "m.room.member"}), null)).to.eventually.equal("user_sync_handled");
        });
        it("should pass other member types to state event", () => {
            const handler = createRH();
            handler.HandleInvite = (ev) => Promise.resolve("invited");
            return expect(handler.OnEvent(buildRequest({
                content: {membership: "join"},
                state_key: "@bacon:localhost",
                type: "m.room.member"}), null)).to.eventually.equal("stateevent");
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
        it("should alert if encryption is turned on", () => {
            const handler = createRH();
            const context = {
                rooms: {
                    remote: {
                        roomId: "_discord_123_456",
                    },
                },
            };
            return expect(handler.OnEvent(buildRequest({
                type: "m.room.encryption", room_id: "!accept:localhost"}), context)).to.eventually.be.fulfilled;
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
        it("should process stickers", () => {
            const handler = createRH();
            const context = {
                rooms: {
                    remote: {
                        roomId: "_discord_123_456",
                    },
                },
            };
            return expect(handler.OnEvent(buildRequest({
                type: "m.sticker",
                content: {
                    body: "abc",
                    url: "mxc://abc",
                },
            }), context)).to.eventually.equal("processed");
        });
    });
    describe("HandleInvite", () => {
        it("should accept invite for bot user", async () => {
            const handler: any = createRH();
            await handler.HandleInvite({
                state_key: "@botuser:localhost",
            });
            expect(USERSJOINED).to.equal(1);
        });
        it("should deny invite for other users", () => {
            const handler: any = createRH();
            handler.joinRoom = () => Promise.resolve("joinedroom");
            return expect(handler.HandleInvite({
                state_key: "@user:localhost",
            })).to.eventually.be.equal("stateevent");
        });
    });
    describe("ProcessCommand", () => {
        it("should not process command if not in room", () => {
            const handler: any = createRH({disableSS: true});
            return expect(handler.ProcessCommand({
                room_id: "!666:localhost",
            })).to.eventually.be.undefined;
        });
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
        describe("!discord bridge", () => {
            it("will bridge a new room, and ask for permissions", () => {
                const handler: any = createRH({powerLevels: {
                        users_default: 100,
                    }});
                const context = {rooms: {}};
                return handler.ProcessCommand({
                    room_id: "!123:localhost",
                    content: {body: "!discord bridge 123 456"},
                }, context).then((evt) => {
                    return expect(evt.body).to.be.eq("I have bridged this room to your channel");
                });
            });
            it("will fail to bridge if permissions were denied", () => {
                const handler: any = createRH({powerLevels: {
                        users_default: 100,
                    }, denyBridgePermission: true});
                const context = {rooms: {}};
                return handler.ProcessCommand({
                    room_id: "!123:localhost",
                    content: {body: "!discord bridge 123 456"},
                }, context).then((evt) => {
                    return expect(evt.body).to.be.eq("The bridge has been declined by the Discord guild");
                });
            });
            it("will fail to bridge if permissions were denied", () => {
                const handler: any = createRH({powerLevels: {
                        users_default: 100,
                    }, failBridgeMatrix: true});
                const context = {rooms: {}};
                return handler.ProcessCommand({
                    room_id: "!123:localhost",
                    content: {body: "!discord bridge 123 456"},
                }, context).then((evt) => {
                    return expect(evt.body).to.be
                        .eq("There was a problem bridging that channel - has the guild owner approved the bridge?");
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
                    return expect(evt.body).to.be.eq("This room is already bridged to a Discord guild.");
                });
            });
            it("will not bridge without required args", () => {
                const handler: any = createRH({powerLevels: {
                        users_default: 100,
                    }});
                const context = {rooms: {}};
                return handler.ProcessCommand({
                    room_id: "!123:localhost",
                    content: {body: "!discord bridge"},
                }, context).then((evt) => {
                    return expect(evt.body).to.contain("Invalid syntax");
                });
            });
        });
        describe("!discord unbridge", () => {
            it("will unbridge", () => {
                const handler: any = createRH({powerLevels: {
                        users_default: 100,
                    }});
                const context = {rooms: { remote: {
                    data: {
                        plumbed: true,
                    },
                        } }};
                return handler.ProcessCommand({
                    room_id: "!123:localhost",
                    content: {body: "!discord unbridge"},
                }, context).then((evt) => {
                    return expect(evt.body).to.be.eq("This room has been unbridged");
                });
            });
            it("will not unbridge if a link does not exist", () => {
                const handler: any = createRH({powerLevels: {
                        users_default: 100,
                    }});
                const context = {rooms: { remote: undefined }};
                return handler.ProcessCommand({
                    room_id: "!123:localhost",
                    content: {body: "!discord unbridge"},
                }, context).then((evt) => {
                    return expect(evt.body).to.be.eq("This room is not bridged.");
                });
            });
            it("will not unbridge non-plumbed rooms", () => {
                const handler: any = createRH({powerLevels: {
                        users_default: 100,
                    }});
                const context = {rooms: { remote: {
                            data: {
                                plumbed: false,
                }}}};
                return handler.ProcessCommand({
                    room_id: "!123:localhost",
                    content: {body: "!discord unbridge"},
                }, context).then((evt) => {
                    return expect(evt.body).to.be.eq("This room cannot be unbridged.");
                });
            });
            it("will show error if unbridge fails", () => {
                const handler: any = createRH({powerLevels: {
                        users_default: 100,
                    }, failUnbridge: true});
                const context = {rooms: { remote: {
                            data: {
                                plumbed: true,
                            }}}};
                return handler.ProcessCommand({
                    room_id: "!123:localhost",
                    content: {body: "!discord unbridge"},
                }, context).then((evt) => {
                    return expect(evt.body).to.contain("There was an error unbridging this room.");
                });
            });
        });
    });
    describe("OnAliasQuery", () => {
        it("will create room", () => {
            const handler: any = createRH({});
            handler.createMatrixRoom = () => true;
            return expect(handler.OnAliasQuery(
                "_discord_123_456:localhost",
                "_discord_123_456")).to.eventually.be.true;
        });
        it("will not create room if guild cannot be found", () => {
            const handler: any = createRH({});
            handler.createMatrixRoom = () => true;
            return expect(handler.OnAliasQuery(
                "_discord_111_456:localhost",
                "_discord_111_456")).to.eventually.be.undefined;
        });
        it("will not create room if channel cannot be found", () => {
            const handler: any = createRH({});
            handler.createMatrixRoom = () => true;
            return expect(handler.OnAliasQuery(
                "_discord_123_444:localhost",
                "_discord_123_444")).to.eventually.be.undefined;
        });
        it("will not create room if alias is wrong", () => {
            const handler: any = createRH({});
            handler.createMatrixRoom = () => true;
            return expect(handler.OnAliasQuery(
                "_discord_123:localhost",
                "_discord_123")).to.be.undefined;
        });
    });
    describe("tpGetProtocol", () => {
       it("will return an object", () => {
           const handler: any = createRH({});
           return handler.tpGetProtocol("").then((protocol) => {
               expect(protocol).to.not.be.null;
               expect(protocol.instances[0].network_id).to.equal("123");
               expect(protocol.instances[0].bot_user_id).to.equal("@botuser:localhost");
               expect(protocol.instances[0].desc).to.equal("123");
               expect(protocol.instances[0].network_id).to.equal("123");
           });
       });
    });
    describe("tpGetLocation", () => {
        it("will return an array", () => {
            const handler: any = createRH({});
            return handler.tpGetLocation("", {
                guild_id: "",
                channel_name: "",
            }).then((channels) => {
                expect(channels).to.be.a("array");
            });
        });
    });
    describe("tpParseLocation", () => {
        it("will reject", () => {
            const handler: any = createRH({});
            return expect(handler.tpParseLocation("alias")).to.eventually.be.rejected;
        });
    });
    describe("tpGetUser", () => {
        it("will reject", () => {
            const handler: any = createRH({});
            return expect(handler.tpGetUser("", {})).to.eventually.be.rejected;
        });
    });
    describe("tpParseUser", () => {
        it("will reject", () => {
            const handler: any = createRH({});
            return expect(handler.tpParseUser("alias")).to.eventually.be.rejected;
        });
    });
    describe("joinRoom", () => {
        it("will join immediately", () => {
            const handler: any = createRH({});
            const intent = {
                getClient: () => {
                    return {
                      joinRoom: () => {
                          return Promise.resolve();
                      },
                    };
                },
            };
            const startTime = Date.now();
            const MAXTIME = 1000;
            return expect(handler.joinRoom(intent, "#test:localhost")).to.eventually.be.fulfilled.and.satisfy(() => {
                return (Date.now() - startTime) < MAXTIME;
            });
        });
        it("will fail first, join after", () => {
            const handler: any = createRH({});
            let shouldFail = true;
            const intent = {
                getClient: () => {
                    return {
                        joinRoom: () => {
                            if (shouldFail) {
                                shouldFail = false;
                                return Promise.reject("Test failed first time");
                            }
                            return Promise.resolve();
                        },
                        getUserId: () => "@test:localhost",
                    };
                },
            };
            const startTime = Date.now();
            const MINTIME = 1000;
            return expect(handler.joinRoom(intent, "#test:localhost")).to.eventually.be.fulfilled.and.satisfy(() => {
                expect(shouldFail).to.be.false;
                return (Date.now() - startTime) > MINTIME;
            });
        });
    });
    describe("createMatrixRoom", () => {
        it("will return an object", () => {
            const handler: any = createRH({});
            const channel = new MockChannel("123", new MockGuild("456"));
            const roomOpts = handler.createMatrixRoom(channel, "#test:localhost");
            expect(roomOpts.creationOpts).to.exist;
            expect(roomOpts.remote).to.exist;
        });
    });
    describe("HandleDiscordCommand", () => {
        it("will kick a member", () => {
            const handler: any = createRH({});
            const channel = new MockChannel("123");
            const guild = new MockGuild("456", [channel]);
            channel.guild = guild;
            const member: any = new MockMember("123456", "blah");
            member.hasPermission = () => {
                return true;
            };
            const message = {
                channel,
                member,
                content: "!matrix kick someuser",
            };
            return handler.HandleDiscordCommand(message).then(() => {
                expect(USERSKICKED).equals(1);
            });
        });
        it("will kick a member in all guild rooms", () => {
            const handler: any = createRH({});
            const channel = new MockChannel("123");
            const guild = new MockGuild("456", [channel, (new MockChannel("456"))]);
            channel.guild = guild;
            const member: any = new MockMember("123456", "blah");
            member.hasPermission = () => {
                return true;
            };
            const message = {
                channel,
                member,
                content: "!matrix kick someuser",
            };
            return handler.HandleDiscordCommand(message).then(() => {
                // tslint:disable-next-line:no-magic-numbers
                expect(USERSKICKED).equals(2);
            });
        });
        it("will deny permission", () => {
            const handler: any = createRH({});
            const channel = new MockChannel("123");
            const guild = new MockGuild("456", [channel]);
            channel.guild = guild;
            const member: any = new MockMember("123456", "blah");
            member.hasPermission = () => {
                return false;
            };
            const message = {
                channel,
                member,
                content: "!matrix kick someuser",
            };
            return handler.HandleDiscordCommand(message).then(() => {
                expect(USERSKICKED).equals(0);
            });
        });
        it("will ban a member", () => {
            const handler: any = createRH({});
            const channel = new MockChannel("123");
            const guild = new MockGuild("456", [channel]);
            channel.guild = guild;
            const member: any = new MockMember("123456", "blah");
            member.hasPermission = () => {
                return true;
            };
            const message = {
                channel,
                member,
                content: "!matrix ban someuser",
            };
            return handler.HandleDiscordCommand(message).then(() => {
                expect(USERSBANNED).equals(1);
            });
        });
        it("will unban a member", () => {
            const handler: any = createRH({});
            const channel = new MockChannel("123");
            const guild = new MockGuild("456", [channel]);
            channel.guild = guild;
            const member: any = new MockMember("123456", "blah");
            member.hasPermission = () => {
                return true;
            };
            const message = {
                channel,
                member,
                content: "!matrix unban someuser",
            };
            return handler.HandleDiscordCommand(message).then(() => {
                expect(USERSUNBANNED).equals(1);
            });
        });
    });
});
