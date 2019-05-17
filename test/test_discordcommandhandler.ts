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
import * as Proxyquire from "proxyquire";

import { DiscordCommandHandler } from "../src/discordcommandhandler";
import { MockChannel } from "./mocks/channel";
import { MockMember } from "./mocks/member";
import { MockGuild } from "./mocks/guild";
import { Util } from "../src/util";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

const expect = Chai.expect;

let USERSJOINED = 0;
let USERSKICKED = 0;
let USERSBANNED = 0;
let USERSUNBANNED = 0;
let ROOMSUNBRIDGED = 0;
let MESSAGESENT: any = {};
let MARKED = -1;
function createCH(opts: any = {}) {
    USERSJOINED = 0;
    USERSKICKED = 0;
    USERSBANNED = 0;
    USERSUNBANNED = 0;
    ROOMSUNBRIDGED = 0;
    MESSAGESENT = {};
    MARKED = -1;
    const bridge = {
        getIntent: () => {
            return {
                ban: async () => { USERSBANNED++; },
                getEvent: () => ({ content: { } }),
                join: () => { USERSJOINED++; },
                kick: async () => { USERSKICKED++; },
                leave: () => { },
                sendMessage: async (roomId, content) => { MESSAGESENT = content; return content; },
                unban: async () => { USERSUNBANNED++; },
            };
        },
    };
    const cs = {
        GetRoomIdsFromChannel: async (chan) => {
            return [`#${chan.id}:localhost`];
        },
    };
    const discord = {
        ChannelSyncroniser: cs,
        Provisioner: {
            HasPendingRequest: (chan) => true,
            MarkApproved: async (chan, member, approved) => {
                MARKED = approved ? 1 : 0;
                return approved;
            },
            UnbridgeChannel: () => {
                ROOMSUNBRIDGED++;
            },
        },
    };
    const discordCommandHndlr = (Proxyquire("../src/discordcommandhandler", {
        "./util": {
            Util: {
                GetMxidFromName: () => {
                    return "@123456:localhost";
                },
                ParseCommand: Util.ParseCommand,
            },
        },
    })).DiscordCommandHandler;
    return new discordCommandHndlr(bridge as any, discord as any);
}

describe("DiscordCommandHandler", () => {
    it("will kick a member", async () => {
        const handler: any = createCH();
        const channel = new MockChannel("123");
        const guild = new MockGuild("456", [channel]);
        channel.guild = guild;
        const member: any = new MockMember("123456", "blah");
        member.hasPermission = () => {
            return true;
        };
        const message = {
            channel,
            content: "!matrix kick someuser",
            member,
        };
        await handler.Process(message);
        expect(USERSKICKED).equals(1);
    });
    it("will kick a member in all guild rooms", async () => {
        const handler: any = createCH();
        const channel = new MockChannel("123");
        const guild = new MockGuild("456", [channel, (new MockChannel("456"))]);
        channel.guild = guild;
        const member: any = new MockMember("123456", "blah");
        member.hasPermission = () => {
            return true;
        };
        const message = {
            channel,
            content: "!matrix kick someuser",
            member,
        };
        await handler.Process(message);
        // tslint:disable-next-line:no-magic-numbers
        expect(USERSKICKED).equals(2);
    });
    it("will deny permission", async () => {
        const handler: any = createCH();
        const channel = new MockChannel("123");
        const guild = new MockGuild("456", [channel]);
        channel.guild = guild;
        const member: any = new MockMember("123456", "blah");
        member.hasPermission = () => {
            return false;
        };
        const message = {
            channel,
            content: "!matrix kick someuser",
            member,
        };
        await handler.Process(message);
        expect(USERSKICKED).equals(0);
    });
    it("will ban a member", async () => {
        const handler: any = createCH();
        const channel = new MockChannel("123");
        const guild = new MockGuild("456", [channel]);
        channel.guild = guild;
        const member: any = new MockMember("123456", "blah");
        member.hasPermission = () => {
            return true;
        };
        const message = {
            channel,
            content: "!matrix ban someuser",
            member,
        };
        await handler.Process(message);
        expect(USERSBANNED).equals(1);
    });
    it("will unban a member", async () => {
        const handler: any = createCH();
        const channel = new MockChannel("123");
        const guild = new MockGuild("456", [channel]);
        channel.guild = guild;
        const member: any = new MockMember("123456", "blah");
        member.hasPermission = () => {
            return true;
        };
        const message = {
            channel,
            content: "!matrix unban someuser",
            member,
        };
        await handler.Process(message);
        expect(USERSUNBANNED).equals(1);
    });
    it("handles !matrix approve", async () => {
        const handler: any = createCH();
        const channel = new MockChannel("123");
        const guild = new MockGuild("456", [channel]);
        channel.guild = guild;
        const member: any = new MockMember("123456", "blah");
        member.hasPermission = () => {
            return true;
        };
        const message = {
            channel,
            content: "!matrix approve",
            member,
        };
        await handler.Process(message);
        expect(MARKED).equals(1);
    });
    it("handles !matrix deny", async () => {
        const handler: any = createCH();
        const channel = new MockChannel("123");
        const guild = new MockGuild("456", [channel]);
        channel.guild = guild;
        const member: any = new MockMember("123456", "blah");
        member.hasPermission = () => {
            return true;
        };
        const message = {
            channel,
            content: "!matrix deny",
            member,
        };
        await handler.Process(message);
        expect(MARKED).equals(0);
    });
    it("handles !matrix unbridge", async () => {
        const handler: any = createCH();
        const channel = new MockChannel("123");
        const guild = new MockGuild("456", [channel]);
        channel.guild = guild;
        const member: any = new MockMember("123456", "blah");
        member.hasPermission = () => {
            return true;
        };
        const message = {
            channel,
            content: "!matrix unbridge",
            member,
        };
        await handler.Process(message);
        expect(ROOMSUNBRIDGED).equals(1);
    });
});
