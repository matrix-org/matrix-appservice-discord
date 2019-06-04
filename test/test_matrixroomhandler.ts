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
import * as Proxyquire from "proxyquire";
import { DiscordBridgeConfig } from "../src/config";
import { MockChannel } from "./mocks/channel";
import { MockMember } from "./mocks/member";
import { MockGuild } from "./mocks/guild";
import { Util } from "../src/util";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

const expect = Chai.expect;

const RoomHandler = (Proxyquire("../src/matrixroomhandler", {
    "./util": {
        Util: {
            DelayedPromise: Util.DelayedPromise,
            GetMxidFromName: () => {
                return "@123456:localhost";
            },
            MsgToArgs: Util.MsgToArgs,
            ParseCommand: Util.ParseCommand,
        },
    },
})).MatrixRoomHandler;

let USERSJOINED = 0;
let USERSKICKED = 0;
let USERSBANNED = 0;
let USERSUNBANNED = 0;
let MESSAGESENT: any = {};
let USERSYNC_HANDLED = false;
let KICKBAN_HANDLED = false;
let MESSAGE_PROCCESS = "";

function createRH(opts: any = {}) {
    USERSJOINED = 0;
    USERSKICKED = 0;
    USERSBANNED = 0;
    USERSUNBANNED = 0;
    MESSAGESENT = {};
    USERSYNC_HANDLED = false;
    KICKBAN_HANDLED = false;
    MESSAGE_PROCCESS = "";
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
                getEvent: () => ({ content: { } }),
                join: () => { USERSJOINED++; },
                kick: async () => { USERSKICKED++; },
                leave: () => { },
                sendMessage: async (roomId, content) => { MESSAGESENT = content; return content; },
                unban: async () => { USERSUNBANNED++; },
            };
        },
    };
    const us = {
        JoinRoom: async () => { USERSJOINED++; },
        OnMemberState: async () => {
            USERSYNC_HANDLED = true;
        },
        OnUpdateUser: async () => { },
    };
    const cs = {
        GetRoomIdsFromChannel: async (chan) => {
            return [`#${chan.id}:localhost`];
        },
        OnUpdate: async () => { },
    };
    const bot = {
        BotUserId: "@botuser:localhost",
        ChannelSyncroniser: cs,
        GetBotId: () => "bot12345",
        GetChannelFromRoomId: async (roomid: string) => {
            if (roomid === "!accept:localhost") {
                const guild = new MockGuild("666666");
                const chan = new MockChannel("777777", guild);
                if (opts.createMembers) {
                    chan.members.set("12345", new MockMember("12345", "testuser1"));
                    chan.members.set("54321", new MockMember("54321", "testuser2"));
                    chan.members.set("bot12345", new MockMember("bot12345", "botuser"));
                }
                guild.members = chan.members;
                return chan;
            } else {
                throw new Error("Roomid not found");
            }
        },
        GetGuilds: () => [new MockGuild("123", [])],
        GetIntentFromDiscordMember: () => {
            return bridge.getIntent();
        },
        HandleMatrixKickBan: async () => {
            KICKBAN_HANDLED = true;
        },
        LookupRoom: async (guildid, discordid) => {
            if (guildid !== "123") {
                throw new Error("Guild not found");
            } else if (discordid !== "456") {
                throw new Error("Channel not found");
            }
            const channel = new MockChannel();
            return {channel, botUser: true };
        },
        ProcessMatrixMsgEvent: async () => {
            MESSAGE_PROCCESS = "processed";
        },
        ProcessMatrixRedact: async () => {
            MESSAGE_PROCCESS = "redacted";
        },
        ProcessMatrixStateEvent: async () => {
            MESSAGE_PROCCESS = "stateevent";
        },
        ThirdpartySearchForChannels: () => {
            return [];
        },
        UserSyncroniser: us,
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
    const store = {
        getEntriesByMatrixId: (matrixId) => {
            return [{
                matrix: {},
                remote: {},
            }];
        },
        linkRooms: () => {

        },
        removeEntriesByMatrixRoomId: () => {

        },
    };
    const handler = new RoomHandler(bot as any, config, provisioner as any, bridge as any, store);
    return handler;
}

describe("MatrixRoomHandler", () => {
    describe("OnAliasQueried", () => {
        it("should join successfully", async () => {
            const handler = createRH();
            await handler.OnAliasQueried("#accept:localhost", "!accept:localhost");
        });
        it("should join successfully and create ghosts", async () => {
            const EXPECTEDUSERS = 2;
            const handler = createRH({createMembers: true});
            await handler.OnAliasQueried("#accept:localhost", "!accept:localhost");
            expect(USERSJOINED).to.equal(EXPECTEDUSERS);
        });
        it("should not join successfully", async () => {
            const handler = createRH();
            try {
                await handler.OnAliasQueried("#reject:localhost", "!reject:localhost");
                throw new Error("didn't fail");
            } catch (e) {
                expect(e.message).to.not.equal("didn't fail");
            }
        });
    });
    describe("OnAliasQuery", () => {
        it("will create room", async () => {
            const handler: any = createRH({});
            handler.createMatrixRoom = () => true;
            const ret = await handler.OnAliasQuery(
                "_discord_123_456:localhost",
                "_discord_123_456");
            expect(ret).to.be.true;
        });
        it("will not create room if guild cannot be found", async () => {
            const handler: any = createRH({});
            handler.createMatrixRoom = () => true;
            const ret = await handler.OnAliasQuery(
                "_discord_111_456:localhost",
                "_discord_111_456");
            expect(ret).to.be.undefined;
        });
        it("will not create room if channel cannot be found", async () => {
            const handler: any = createRH({});
            handler.createMatrixRoom = () => true;
            const ret = await handler.OnAliasQuery(
                "_discord_123_444:localhost",
                "_discord_123_444");
            expect(ret).to.be.undefined;
        });
        it("will not create room if alias is wrong", async () => {
            const handler: any = createRH({});
            handler.createMatrixRoom = () => true;
            const ret = await handler.OnAliasQuery(
                "_discord_123:localhost",
                "_discord_123");
            expect(ret).to.be.undefined;
        });
    });
    describe("tpGetProtocol", () => {
       it("will return an object", async () => {
           const handler: any = createRH({});
           const protocol = await handler.tpGetProtocol("");
           expect(protocol).to.not.be.null;
           expect(protocol.instances[0].network_id).to.equal("123");
           expect(protocol.instances[0].bot_user_id).to.equal("@botuser:localhost");
           expect(protocol.instances[0].desc).to.equal("123");
           expect(protocol.instances[0].network_id).to.equal("123");
       });
    });
    describe("tpGetLocation", () => {
        it("will return an array", async () => {
            const handler: any = createRH({});
            const channels = await handler.tpGetLocation("", {
                channel_name: "",
                guild_id: "",
            });
            expect(channels).to.be.a("array");
        });
    });
    describe("tpParseLocation", () => {
        it("will reject", async () => {
            const handler: any = createRH({});
            try {
                await handler.tpParseLocation("alias");
                throw new Error("didn't fail");
            } catch (e) {
                expect(e.message).to.not.equal("didn't fail");
            }
        });
    });
    describe("tpGetUser", () => {
        it("will reject", async () => {
            const handler: any = createRH({});
            try {
                await handler.tpGetUser("", {});
                throw new Error("didn't fail");
            } catch (e) {
                expect(e.message).to.not.equal("didn't fail");
            }
        });
    });
    describe("tpParseUser", () => {
        it("will reject", async () => {
            const handler: any = createRH({});
            try {
                await handler.tpParseUser("alias");
                throw new Error("didn't fail");
            } catch (e) {
                expect(e.message).to.not.equal("didn't fail");
            }
        });
    });
    describe("joinRoom", () => {
        it("will join immediately", async () => {
            const handler: any = createRH({});
            const intent = {
                getClient: () => {
                    return {
                        joinRoom: async () => { },
                    };
                },
            };
            const startTime = Date.now();
            const MAXTIME = 1000;
            await handler.joinRoom(intent, "#test:localhost");
            expect(1).to.satisfy(() => {
                return (Date.now() - startTime) < MAXTIME;
            });
        });
        it("will fail first, join after", async () => {
            const handler: any = createRH({});
            let shouldFail = true;
            const intent = {
                getClient: () => {
                    return {
                        getUserId: () => "@test:localhost",
                        joinRoom: async () => {
                            if (shouldFail) {
                                shouldFail = false;
                                throw new Error("Test failed first time");
                            }
                        },
                    };
                },
            };
            const startTime = Date.now();
            const MINTIME = 1000;
            await handler.joinRoom(intent, "#test:localhost");
            expect(shouldFail).to.be.false;
            expect(1).to.satisfy(() => {
                return (Date.now() - startTime) > MINTIME;
            });
        });
    });
    describe("createMatrixRoom", () => {
        it("will return an object", async () => {
            const handler: any = createRH({});
            const channel = new MockChannel("123", new MockGuild("456"));
            const roomOpts = await handler.createMatrixRoom(channel, "#test:localhost");
            expect(roomOpts.creationOpts).to.exist;
        });
    });
});
