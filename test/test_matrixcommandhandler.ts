/*
Copyright 2019 matrix-appservice-discord

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
import { Util } from "../src/util";
import { DiscordBridgeConfig } from "../src/config";
import { MockChannel } from "./mocks/channel";
import * as Proxyquire from "proxyquire";

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
        UnbridgeChannel: async () => {
            if (opts.failUnbridge) {
                throw new Error("Test failed unbridge");
            }
        },
    };
    const bot = {
        GetBotId: () => "@botuser:localhost",
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
    };

    const MatrixCommandHndl = (Proxyquire("../src/matrixcommandhandler", {
        "./util": {
            Util: {
                CheckMatrixPermission: async () => {
                    return opts.power !== undefined ? opts.power : true;
                },
                GetBotLink: Util.GetBotLink,
                ParseCommand: Util.ParseCommand,
            },
        },
    })).MatrixCommandHandler;
    return new MatrixCommandHndl(bot as any, bridge, config);
}

function createEvent(msg: string, room?: string, userId?: string) {
    return {
        content: {
            body: msg,
        },
        room_id: room ? room : "!123:localhost",
        sender: userId,
    };
}

function createContext(remoteData?: any) {
    return {
        rooms: {
            remote: remoteData,
        },
    };
}

describe("MatrixCommandHandler", () => {
    describe("Process", () => {
        it("should not process command if not in room", async () => {
            const handler: any = createCH({disableSS: true});
            await handler.Process(createEvent("", "!666:localhost"), createContext());
            expect(MESSAGESENT.body).to.equal(undefined);
        });
        it("should warn if self service is disabled", async () => {
            const handler: any = createCH({disableSS: true});
            await handler.Process(createEvent("!discord bridge"), createContext());
            expect(MESSAGESENT.body).to.equal("**ERROR:** The owner of this bridge does " +
                "not permit self-service bridging.");
        });
        it("should warn if user is not powerful enough", async () => {
            const handler: any = createCH({
                power: false,
            });
            await handler.Process(createEvent("!discord bridge"), createContext());
            expect(MESSAGESENT.body).to.equal("**ERROR:** insufficiant permissions to use this " +
                "command! Try `!discord help` to see all available commands");
        });
        describe("!discord bridge", () => {
            it("will bridge a new room, and ask for permissions", async () => {
                const handler: any = createCH();
                await handler.Process(createEvent("!discord bridge 123 456"), createContext());
                expect(MESSAGESENT.body).to.equal("I have bridged this room to your channel");
            });
            it("will fail to bridge if permissions were denied", async () => {
                const handler: any = createCH({
                    denyBridgePermission: true,
                });
                await handler.Process(createEvent("!discord bridge 123 456"), createContext());
                expect(MESSAGESENT.body).to.equal("The bridge has been declined by the Discord guild");
            });
            it("will fail to bridge if permissions were failed", async () => {
                const handler: any = createCH({
                    failBridgeMatrix: true,
                });
                const evt = await handler.Process(createEvent("!discord bridge 123 456"), createContext());
                expect(MESSAGESENT.body).to.equal("There was a problem bridging that channel - has " +
                    "the guild owner approved the bridge?");
            });
            it("will not bridge if a link already exists", async () => {
                const handler: any = createCH();
                const evt = await handler.Process(createEvent("!discord bridge 123 456"), createContext(true));
                expect(MESSAGESENT.body).to.equal("This room is already bridged to a Discord guild.");
            });
            it("will not bridge without required args", async () => {
                const handler: any = createCH();
                const evt = await handler.Process(createEvent("!discord bridge"), createContext());
                expect(MESSAGESENT.body).to.contain("Invalid syntax");
            });
            it("will bridge with x/y syntax", async () => {
                const handler: any = createCH({powerLevels: {
                        users_default: 100,
                    }});
                const evt = await handler.Process(createEvent("!discord bridge 123/456"), createContext());
                expect(MESSAGESENT.body).equals("I have bridged this room to your channel");
            });
        });
        describe("!discord unbridge", () => {
            it("will unbridge", async () => {
                const handler: any = createCH();
                await handler.Process(createEvent("!discord unbridge"), createContext(
                    {
                        data: {
                            discord_channel: "456",
                            discord_guild: "123",
                            plumbed: true,
                        },
                    },
                ));
                expect(MESSAGESENT.body).equals("This room has been unbridged");
            });
            it("will not unbridge if a link does not exist", async () => {
                const handler: any = createCH();
                await handler.Process(createEvent("!discord unbridge"), createContext());
                expect(MESSAGESENT.body).equals("This room is not bridged.");
            });
            it("will not unbridge non-plumbed rooms", async () => {
                const handler: any = createCH();
                await handler.Process(createEvent("!discord unbridge"), createContext(
                    {
                        data: {
                            discord_channel: "456",
                            discord_guild: "123",
                            plumbed: false,
                        },
                    },
                ));
                expect(MESSAGESENT.body).equals("This room cannot be unbridged.");
            });
            it("will show error if unbridge fails", async () => {
                const handler: any = createCH({
                    failUnbridge: true,
                });
                await handler.Process(createEvent("!discord unbridge"), createContext(
                    {
                        data: {
                            discord_channel: "456",
                            discord_guild: "123",
                            plumbed: true,
                        },
                    },
                ));
                expect(MESSAGESENT.body).to.contain("There was an error unbridging this room.");
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
