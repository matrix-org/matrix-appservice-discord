import * as Chai from "chai";
import { MatrixCommandHandler } from "../src/matrixcommandhandler";
import { DiscordBridgeConfig } from "../src/config";
import { MockChannel } from "./mocks/channel";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

const expect = Chai.expect;

let USERSJOINED = 0;
let USERSKICKED = 0;
let USERSBANNED = 0;
let USERSUNBANNED = 0;
let MESSAGESENT: any = {};

function createCH(opts: any = {}) {
    USERSJOINED = 0;
    USERSKICKED = 0;
    USERSBANNED = 0;
    USERSUNBANNED = 0;
    MESSAGESENT = {};

    const bridge = {
        getBot: () => {
            return {
                getJoinedRooms: () => ["!123:localhost"],
                isRemoteUser: (id) => {
                    return id !== undefined && id.startsWith("@_discord_");
                },
            };
        },
        getIntent: () => {
            return {
                ban: async () => { USERSBANNED++; },
                getClient: () => mxClient,
                join: () => { USERSJOINED++; },
                joinRoom: async () => { USERSJOINED++; },
                kick: async () => { USERSKICKED++; },
                leave: () => { },
                sendMessage: async (roomId, content) => { MESSAGESENT = content; return content; },
                unban: async () => { USERSUNBANNED++; },
            };
        },
    };

    const config = new DiscordBridgeConfig();
    config.limits.roomGhostJoinDelay = 0;
    if (opts.disableSS) {
        config.bridge.enableSelfServiceBridging = false;
    } else {
        config.bridge.enableSelfServiceBridging = true;
    }
    const mxClient = {
        getStateEvent: async () => {
            return opts.powerLevels || {};
        },
        getUserId: () => "@user:localhost",
        joinRoom: async () => {
            USERSJOINED++;
        },
        sendReadReceipt: async () => { },
        setRoomDirectoryVisibilityAppService: async () => { },
    };
    const provisioner = {
        AskBridgePermission: async () => {
            if (opts.denyBridgePermission) {
                throw new Error("The bridge has been declined by the Discord guild");
            }
        },
        BridgeMatrixRoom: () => {
            if (opts.failBridgeMatrix) {
                throw new Error("Test failed matrix bridge");
            }
        },
        UnbridgeRoom: async () => {
            if (opts.failUnbridge) {
                throw new Error("Test failed unbridge");
            }
        },
    };
    const bot = {
        LookupRoom: async (guildid, discordid) => {
            if (guildid !== "123") {
                throw new Error("Guild not found");
            } else if (discordid !== "456") {
                throw new Error("Channel not found");
            }
            const channel = new MockChannel();
            return {channel, botUser: true };
        },
        Provisioner: provisioner,
        getBotId: () => "@botuser:localhost",
    };
    const ch = new MatrixCommandHandler(bot as any, config);
    ch.setBridge(bridge);
    return ch;
}

describe("MatrixCommandHandler", () => {
    describe("ProcessCommand", () => {
        it("should not process command if not in room", async () => {
            const handler: any = createCH({disableSS: true});
            const ret = await handler.ProcessCommand({
                room_id: "!666:localhost",
            });
            expect(ret).to.be.undefined;
        });
        it("should warn if self service is disabled", async () => {
            const handler: any = createCH({disableSS: true});
            await handler.ProcessCommand({
                room_id: "!123:localhost",
            });
            expect(MESSAGESENT.body).equals("The owner of this bridge does not permit self-service bridging.");
        });
        it("should warn if user is not powerful enough with defaults", async () => {
            const handler: any = createCH();
            await handler.ProcessCommand({
                room_id: "!123:localhost",
            });
            expect(MESSAGESENT.body).equals("You do not have the required power level in this room to " +
                "create a bridge to a Discord channel.");
        });
        it("should warn if user is not powerful enough with custom state default", async () => {
            const handler: any = createCH({powerLevels: {
                state_default: 67,
            }});
            await handler.ProcessCommand({
                room_id: "!123:localhost",
            });
            expect(MESSAGESENT.body).equals("You do not have the required power level in this room to " +
                "create a bridge to a Discord channel.");
        });
        it("should allow if user is powerful enough with defaults", async () => {
            const handler: any = createCH({powerLevels: {
                users_default: 60,
            }});
            const evt = await handler.ProcessCommand({
                content: {body: "!discord help"},
                room_id: "!123:localhost",
            });
            expect(evt.body.startsWith("Available commands")).to.be.true;
        });
        it("should allow if user is powerful enough with their own state", async () => {
            const handler: any = createCH({powerLevels: {
                users: {
                 "@user:localhost": 100,
                },
            }});
            const evt = await handler.ProcessCommand({
                content: {body: "!discord help"},
                room_id: "!123:localhost",
                sender: "@user:localhost",
            });
            expect(evt.body.startsWith("Available commands")).to.be.true;
        });
        describe("!discord bridge", () => {
            it("will bridge a new room, and ask for permissions", async () => {
                const handler: any = createCH({powerLevels: {
                        users_default: 100,
                    }});
                const context = {rooms: {}};
                const evt = await handler.ProcessCommand({
                    content: {body: "!discord bridge 123 456"},
                    room_id: "!123:localhost",
                }, context);
                expect(evt.body).equals("I have bridged this room to your channel");
            });
            it("will fail to bridge if permissions were denied", async () => {
                const handler: any = createCH({
                    denyBridgePermission: true,
                    powerLevels: {
                        users_default: 100,
                    },
                });
                const context = {rooms: {}};
                const evt = await handler.ProcessCommand({
                    content: {body: "!discord bridge 123 456"},
                    room_id: "!123:localhost",
                }, context);
                expect(evt.body).equals("The bridge has been declined by the Discord guild");
            });
            it("will fail to bridge if permissions were denied", async () => {
                const handler: any = createCH({
                    failBridgeMatrix: true,
                    powerLevels: {
                        users_default: 100,
                    },
                });
                const context = {rooms: {}};
                const evt = await handler.ProcessCommand({
                    content: {body: "!discord bridge 123 456"},
                    room_id: "!123:localhost",
                }, context);
                expect(evt.body).equals("There was a problem bridging that channel - has " +
                    "the guild owner approved the bridge?");
            });
            it("will not bridge if a link already exists", async () => {
                const handler: any = createCH({
                    powerLevels: {
                        users_default: 100,
                    },
                });
                const context = {rooms: { remote: true }};
                const evt = await handler.ProcessCommand({
                    content: {body: "!discord bridge"},
                    room_id: "!123:localhost",
                }, context);
                expect(evt.body).equals("This room is already bridged to a Discord guild.");
            });
            it("will not bridge without required args", async () => {
                const handler: any = createCH({
                    powerLevels: {
                        users_default: 100,
                    },
                });
                const context = {rooms: {}};
                const evt = await handler.ProcessCommand({
                    content: {body: "!discord bridge"},
                    room_id: "!123:localhost",
                }, context);
                expect(evt.body).to.contain("Invalid syntax");
            });
            it("will bridge with x/y syntax", async () => {
                const handler: any = createCH({powerLevels: {
                        users_default: 100,
                    }});
                const context = {rooms: {}};
                const evt = await handler.ProcessCommand({
                    content: {body: "!discord bridge 123/456"},
                    room_id: "!123:localhost",
                }, context);
                expect(evt.body).equals("I have bridged this room to your channel");
            });
        });
        describe("!discord unbridge", () => {
            it("will unbridge", async () => {
                const handler: any = createCH({
                    powerLevels: {
                        users_default: 100,
                    },
                });
                const context = {rooms: { remote: {
                    data: {
                        plumbed: true,
                    },
                } }};
                const evt = await handler.ProcessCommand({
                    content: {body: "!discord unbridge"},
                    room_id: "!123:localhost",
                }, context);
                expect(evt.body).equals("This room has been unbridged");
            });
            it("will not unbridge if a link does not exist", async () => {
                const handler: any = createCH({
                    powerLevels: {
                        users_default: 100,
                    },
                });
                const context = {rooms: { remote: undefined }};
                const evt = await handler.ProcessCommand({
                    content: {body: "!discord unbridge"},
                    room_id: "!123:localhost",
                }, context);
                expect(evt.body).equals("This room is not bridged.");
            });
            it("will not unbridge non-plumbed rooms", async () => {
                const handler: any = createCH({
                    powerLevels: {
                        users_default: 100,
                    },
                });
                const context = {rooms: { remote: {
                    data: {
                        plumbed: false,
                    },
                }}};
                const evt = await handler.ProcessCommand({
                    content: {body: "!discord unbridge"},
                    room_id: "!123:localhost",
                }, context);
                expect(evt.body).equals("This room cannot be unbridged.");
            });
            it("will show error if unbridge fails", async () => {
                const handler: any = createCH({
                    failUnbridge: true,
                    powerLevels: {
                        users_default: 100,
                    },
                });
                const context = {rooms: { remote: {
                    data: {
                        plumbed: true,
                    },
                }}};
                const evt = await handler.ProcessCommand({
                    content: {body: "!discord unbridge"},
                    room_id: "!123:localhost",
                }, context);
                expect(evt.body).to.contain("There was an error unbridging this room.");
            });
        });
    });
    describe("HandleInvite", () => {
        it("should accept invite for bot user", async () => {
            const handler: any = createCH();
            let joinedRoom = false;
            handler.joinRoom = async () => {
                joinedRoom = true;
            };
            await handler.HandleInvite({
                state_key: "@botuser:localhost",
            });
            expect(USERSJOINED).to.equal(1);
        });
        it("should deny invite for other users", async () => {
            const handler: any = createCH();
            let joinedRoom = false;
            handler.joinRoom = async () => {
                joinedRoom = true;
            };
            await handler.HandleInvite({
                state_key: "@user:localhost",
            });
            expect(joinedRoom).to.be.false;
        });
    });
});
