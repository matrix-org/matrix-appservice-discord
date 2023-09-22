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
import { expect } from "chai";
import * as Proxyquire from "proxyquire";

import { MockChannel } from "./mocks/channel";
import { MockMember } from "./mocks/member";
import { MockGuild } from "./mocks/guild";
import { Util } from "../src/util";
import { AppserviceMock } from "./mocks/appservicemock";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

let ROOMSUNBRIDGED = 0;
let MARKED = -1;
function createCH(opts: any = {}) {
    ROOMSUNBRIDGED = 0;
    MARKED = -1;
    const bridge = new AppserviceMock(opts);
    const cs = {
        GetRoomIdsFromChannel: async (chan) => {
            return [`#${chan.id}:localhost`];
        },
    };
    const discord = {
        ChannelSyncroniser: cs,
        Provisioner: {
            HasPendingRequest: (chan): boolean => true,
            MarkApproved: async (chan, member, approved) => {
                MARKED = approved ? 1 : 0;
                return approved;
            },
            UnbridgeChannel: (): void => {
                ROOMSUNBRIDGED++;
            },
        },
    };
    const discordCommandHndlr = (Proxyquire("../src/discordcommandhandler", {
        "./util": {
            Util: {
                GetMxidFromName: (): string => {
                    return "@123456:localhost";
                },
                ParseCommand: Util.ParseCommand,
            },
        },
    })).DiscordCommandHandler;

    const config = {
        bridge: {
            disablePresence: false
        }
    }
    return {handler: new discordCommandHndlr(bridge as any, discord as any, config), bridge};
}

describe("DiscordCommandHandler", () => {
    it("will kick a member", async () => {
        const {handler, bridge} = createCH();
        const channel = new MockChannel("123");
        const guild = new MockGuild("456", [channel]);
        channel.guild = guild;
        const member: any = new MockMember("123456", "blah");
        member.hasPermission = (): boolean => {
            return true;
        };
        const message = {
            channel,
            content: "!matrix kick someuser",
            member,
        };
        await handler.Process(message);
        bridge.botIntent.underlyingClient.wasCalled("kickUser", true, "#123:localhost", "@123456:localhost");
    });

    it("will kick a member in all guild rooms", async () => {
        const {handler, bridge} = createCH();
        const channel = new MockChannel("123");
        const guild = new MockGuild("456", [channel, (new MockChannel("456"))]);
        channel.guild = guild;
        const member: any = new MockMember("123456", "blah");
        member.hasPermission = (): boolean => {
            return true;
        };
        const message = {
            channel,
            content: "!matrix kick someuser",
            member,
        };
        await handler.Process(message);
        expect(bridge.botIntent.underlyingClient.wasCalled("kickUser")).to.equal(2);
    });

    it("will deny permission", async () => {
        const {handler, bridge} = createCH();
        const channel = new MockChannel("123");
        const guild = new MockGuild("456", [channel]);
        channel.guild = guild;
        const member: any = new MockMember("123456", "blah");
        member.hasPermission = (): boolean => {
            return false;
        };
        const message = {
            channel,
            content: "!matrix kick someuser",
            member,
        };
        await handler.Process(message);
        expect(bridge.botIntent.underlyingClient.wasCalled("kickUser", false)).to.equal(0);
    });

    it("will ban a member", async () => {
        const {handler, bridge} = createCH();
        const channel = new MockChannel("123");
        const guild = new MockGuild("456", [channel]);
        channel.guild = guild;
        const member: any = new MockMember("123456", "blah");
        member.hasPermission = (): boolean => {
            return true;
        };
        const message = {
            channel,
            content: "!matrix ban someuser",
            member,
        };
        await handler.Process(message);
        expect(bridge.botIntent.underlyingClient.wasCalled("banUser")).to.equal(1);
    });

    it("will unban a member", async () => {
        const {handler, bridge} = createCH();
        const channel = new MockChannel("123");
        const guild = new MockGuild("456", [channel]);
        channel.guild = guild;
        const member: any = new MockMember("123456", "blah");
        member.hasPermission = (): boolean => {
            return true;
        };
        const message = {
            channel,
            content: "!matrix unban someuser",
            member,
        };
        await handler.Process(message);
        expect(bridge.botIntent.underlyingClient.wasCalled("unbanUser")).to.equal(1);
    });

    it("handles !matrix approve", async () => {
        const {handler} = createCH();
        const channel = new MockChannel("123");
        const guild = new MockGuild("456", [channel]);
        channel.guild = guild;
        const member: any = new MockMember("123456", "blah");
        member.hasPermission = (): boolean => {
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
        const {handler} = createCH();
        const channel = new MockChannel("123");
        const guild = new MockGuild("456", [channel]);
        channel.guild = guild;
        const member: any = new MockMember("123456", "blah");
        member.hasPermission = (): boolean => {
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
        const {handler} = createCH();
        const channel = new MockChannel("123");
        const guild = new MockGuild("456", [channel]);
        channel.guild = guild;
        const member: any = new MockMember("123456", "blah");
        member.hasPermission = (): boolean => {
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

    it("!matrix listusers with 0 Matrix users", async () => {
        const {handler} = createCH();
        handler.bridge.botIntent.underlyingClient.getJoinedRoomMembersWithProfiles = () => {
            return {};
        };
        const channel = new MockChannel("123");
        const guild = new MockGuild("456", [channel]);
        channel.guild = guild;
        const member: any = new MockMember("123456", "blah");
        member.hasPermission = (): boolean => {
            return true;
        };
        const message = {
            channel,
            content: "!matrix listusers",
            member,
        };
        const sentMessage = await handler.Process(message);

        expect(sentMessage).equals(
            "There are **0** users on the Matrix side."
        );
    });

    it("!matrix listusers with 3 Matrix users with presence enabled", async () => {
        const {handler} = createCH({
            userIdPrefix: "@_discord_"
        });
        handler.bridge.botIntent.underlyingClient.getJoinedRoomMembersWithProfiles = () => {
            return {
                "@abc:one.ems.host": { display_name: "ABC" },
                "@def:matrix.org": { display_name: "DEF" },
                "@ghi:mozilla.org": {},
            };
        };
        const channel = new MockChannel("123");
        const guild = new MockGuild("456", [channel]);
        channel.guild = guild;
        const member: any = new MockMember("123456", "blah");
        member.hasPermission = (): boolean => {
            return true;
        };
        const message = {
            channel,
            content: "!matrix listusers",
            member,
        };
        const sentMessage = await handler.Process(message);

        expect(sentMessage).equals(
            "There are **3** users on the Matrix side. Matrix users in <#123> may not necessarily be in the other bridged channels in the server.\n\n• ABC (@abc:one.ems.host) - Online\n• DEF (@def:matrix.org) - Online\n• @ghi:mozilla.org - Online"
        );
    });

    it("assert that !matrix listusers ignores users with namespaced userIdPrefix", async () => {
        const {handler} = createCH({
            userIdPrefix: "@_discord_"
        });
        handler.bridge.botIntent.underlyingClient.getJoinedRoomMembersWithProfiles = () => {
            return {
                "@abc:one.ems.host": { display_name: "ABC" },
                "@_discord_123456:bridge.org": { display_name: "DEF" }
            };
        };
        const channel = new MockChannel("123");
        const guild = new MockGuild("456", [channel]);
        channel.guild = guild;
        const member: any = new MockMember("123456", "blah");
        member.hasPermission = (): boolean => {
            return true;
        };
        const message = {
            channel,
            content: "!matrix listusers",
            member,
        };
        const sentMessage = await handler.Process(message);

        expect(sentMessage).equals(
            "There is **1** user on the Matrix side. Matrix users in <#123> may not necessarily be in the other bridged channels in the server.\n\n• ABC (@abc:one.ems.host) - Online"
        );
    });

    it("assert that !matrix listusers users are displayed in order of presence, display name, then mxid, case insensitive", async () => {
        const {handler} = createCH({
            userIdPrefix: "@_discord_"
        });

        handler.bridge.botClient.getPresenceStatusFor = (userId) => {
            switch (userId) {
                case "@jelly:matrix.org":
                case "@toast:mozilla.org":
                    return { state: "online" };
                case "@jen:matrix.org":
                    return { state: "offline" };
                default:
                    return { state: "unavailable" };
            }
        };

        handler.bridge.botIntent.underlyingClient.getJoinedRoomMembersWithProfiles = () => {
            return {
                "@seth:one.ems.host": { display_name: "Seth" },
                "@sam:one.ems.host": { display_name: "sam" },
                "@jen:matrix.org": { display_name: "Jen" },
                "@toast:mozilla.org": {},
                "@jelly:matrix.org": { display_name: "jelly" }
            };
        };
        const channel = new MockChannel("123");
        const guild = new MockGuild("456", [channel]);
        channel.guild = guild;
        const member: any = new MockMember("123456", "blah");
        member.hasPermission = (): boolean => {
            return true;
        };
        const message = {
            channel,
            content: "!matrix listusers",
            member,
        };
        const sentMessage = await handler.Process(message);

        expect(sentMessage).equals(
            "There are **5** users on the Matrix side. Matrix users in <#123> may not necessarily be in the other bridged channels in the server.\n\n• jelly (@jelly:matrix.org) - Online\n• @toast:mozilla.org - Online\n• sam (@sam:one.ems.host) - Idle\n• Seth (@seth:one.ems.host) - Idle\n• Jen (@jen:matrix.org) - Offline"
        );
    });
});
