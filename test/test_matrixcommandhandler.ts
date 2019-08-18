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
import { AppserviceMock } from "./mocks/appservicemock";
import * as Proxyquire from "proxyquire";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

const expect = Chai.expect;


function createCH(opts: any = {}) {

    const bridge = new AppserviceMock();

    const config = new DiscordBridgeConfig();
    config.limits.roomGhostJoinDelay = 0;
    if (opts.disableSS) {
        config.bridge.enableSelfServiceBridging = false;
    } else {
        config.bridge.enableSelfServiceBridging = true;
    }
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
    return {handler: new MatrixCommandHndl(bot as any, bridge, config), bridge};
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
            const {handler, bridge} = createCH({disableSS: true});
            await handler.Process(createEvent("", "!666:localhost"), createContext());
            bridge.botIntent.wasNotCalled("sendText", true);
        });
        it("should warn if self service is disabled", async () => {
            const {handler, bridge} = createCH({disableSS: true});
            await handler.Process(createEvent("!discord bridge"), createContext());
            const expected = "**ERROR:** The owner of this bridge does not permit self-service bridging.";
            bridge.botIntent.wasCalled("sendText", true, "!123:localhost", expected);
        });
        it("should warn if user is not powerful enough", async () => {
            const {handler, bridge} = createCH({power: false});
            await handler.Process(createEvent("!discord bridge"), createContext());
            const expected = "**ERROR:** insufficiant permissions to use this " +
            "command! Try `!discord help` to see all available commands";
            bridge.botIntent.wasCalled("sendText", true, "!123:localhost", expected);
        });
        describe("!discord bridge", () => {
            it("will bridge a new room, and ask for permissions", async () => {
                const {handler, bridge} = createCH();
                await handler.Process(createEvent("!discord bridge 123 456"), createContext());
                const expected = "I have bridged this room to your channel";
                bridge.botIntent.wasCalled("sendText", true, "!123:localhost", expected);
            });
            it("will fail to bridge if permissions were denied", async () => {
                const {handler, bridge} = createCH({
                    denyBridgePermission: true,
                });
                await handler.Process(createEvent("!discord bridge 123 456"), createContext());
                const expected = "The bridge has been declined by the Discord guild";
                bridge.botIntent.wasCalled("sendText", true, "!123:localhost", expected);
            });
            it("will fail to bridge if permissions were failed", async () => {
                const {handler, bridge}= createCH({
                    failBridgeMatrix: true,
                });
                await handler.Process(createEvent("!discord bridge 123 456"), createContext());
                const expected = "There was a problem bridging that channel - has the guild owner approved the bridge?";
                bridge.botIntent.wasCalled("sendText", true, "!123:localhost", expected);
            });
            it("will not bridge if a link already exists", async () => {
                const {handler, bridge} = createCH();
                const evt = await handler.Process(createEvent("!discord bridge 123 456"), createContext(true));
                const expected = "This room is already bridged to a Discord guild.";
                bridge.botIntent.wasCalled("sendText", true, "!123:localhost", expected);
            });
            it("will not bridge without required args", async () => {
                const {handler, bridge} = createCH();
                const evt = await handler.Process(createEvent("!discord bridge"), createContext());
                const expected = "Invalid syntax";
                bridge.botIntent.wasCalled("sendText", true, "!123:localhost", expected);
            });
            it("will bridge with x/y syntax", async () => {
                const {handler, bridge} = createCH({powerLevels: {
                        users_default: 100,
                    }});
                const evt = await handler.Process(createEvent("!discord bridge 123/456"), createContext());
                const expected = "I have bridged this room to your channel";
                bridge.botIntent.wasCalled("sendText", true, "!123:localhost", expected);
            });
        });
        describe("!discord unbridge", () => {
            it("will unbridge", async () => {
                const {handler, bridge} = createCH();
                await handler.Process(createEvent("!discord unbridge"), createContext(
                    {
                        data: {
                            discord_channel: "456",
                            discord_guild: "123",
                            plumbed: true,
                        },
                    },
                ));
                bridge.botIntent.wasCalled("sendText", true, "!123:localhost", "This room has been unbridged");
            });
            it("will not unbridge if a link does not exist", async () => {
                const {handler, bridge} = createCH();
                await handler.Process(createEvent("!discord unbridge"), createContext());
                bridge.botIntent.wasCalled("sendText", true, "!123:localhost", "This room is not bridged.");
            });
            it("will not unbridge non-plumbed rooms", async () => {
                const {handler, bridge} = createCH();
                await handler.Process(createEvent("!discord unbridge"), createContext(
                    {
                        data: {
                            discord_channel: "456",
                            discord_guild: "123",
                            plumbed: false,
                        },
                    },
                ));
                bridge.botIntent.wasCalled("sendText", true, "!123:localhost", "This room cannot be unbridged.");
            });
            it("will show error if unbridge fails", async () => {
                const {handler, bridge} = createCH({
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
                bridge.botIntent.wasCalled("sendText", true, "!123:localhost", "There was an error unbridging this room.");
            });
        });
    });
    describe("HandleInvite", () => {
        it("should accept invite for bot user", async () => {
            const { handler, bridge } = createCH();
            let joinedRoom = false;
            handler.joinRoom = async () => {
                joinedRoom = true;
            };
            await handler.HandleInvite({
                state_key: "@botuser:localhost",
            });
            bridge.botIntent.wasCalled("joinRoom", true);
        });
        it("should deny invite for other users", async () => {
            const { handler, bridge } = createCH();
            let joinedRoom = false;
            handler.joinRoom = async () => {
                joinedRoom = true;
            };
            await handler.HandleInvite({
                state_key: "@user:localhost",
            });
            bridge.getIntent("@user:localhost").wasNotCalled("joinRoom", true);
            expect(joinedRoom).to.be.false;
        });
    });
});
