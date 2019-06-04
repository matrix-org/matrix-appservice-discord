/*
Copyright 2018 matrix-appservice-discord

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
import { Bridge } from "matrix-appservice-bridge";
import {IGuildMemberState, IUserState, UserSyncroniser} from "../src/usersyncroniser";
import {MockUser} from "./mocks/user";
import {DiscordBridgeConfig} from "../src/config";
import * as Proxyquire from "proxyquire";
import {MockMember} from "./mocks/member";
import {MockGuild} from "./mocks/guild";
import { MockChannel } from "./mocks/channel";
import { MockRole } from "./mocks/role";
import { IMatrixEvent } from "../src/matrixtypes";
import { Util } from "../src/util";
import { RemoteUser } from "../src/db/userstore";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */
const expect = Chai.expect;

let DISPLAYNAME_SET: any = null;
let AVATAR_SET: any = null;
let REMOTEUSER_SET: any = null;
let INTENT_ID: any = null;
let LINK_MX_USER: any = null;
let LINK_RM_USER: any = null;
let UTIL_UPLOADED_AVATAR: any = false;

let SEV_ROOM_ID: any = null;
let SEV_CONTENT: any = null;
let SEV_KEY: any = null;
let JOIN_ROOM_ID: any = null;
let LEAVE_ROOM_ID: any = null;
let JOINS: any = 0;
let LEAVES: any = 0;
let SEV_COUNT: any = 0;

const GUILD_ROOM_IDS = ["!abc:localhost", "!def:localhost", "!ghi:localhost"];
const GUILD_ROOM_IDS_WITH_ROLE = ["!abc:localhost", "!def:localhost"];

const UserSync = (Proxyquire("../src/usersyncroniser", {
    "./util": {
        Util: {
            ApplyPatternString: Util.ApplyPatternString,
            AsyncForEach: Util.AsyncForEach,
            UploadContentFromUrl: async () => {
                UTIL_UPLOADED_AVATAR = true;
                return {mxcUrl: "avatarset"};
            },
        },
    },
})).UserSyncroniser;

function CreateUserSync(remoteUsers: RemoteUser[] = [], ghostConfig: any = {}): UserSyncroniser {
    UTIL_UPLOADED_AVATAR = false;
    SEV_ROOM_ID = null;
    SEV_CONTENT = null;
    SEV_KEY = null;
    SEV_COUNT = 0;
    const bridge: any = {
        getIntent: (id) => {
            DISPLAYNAME_SET = null;
            AVATAR_SET = null;
            INTENT_ID = id;
            JOIN_ROOM_ID = null;
            JOINS = 0;
            LEAVES = 0;
            return {
                getClient: () => {
                    return {
                        getUserId: () => "@user:localhost",
                        sendStateEvent: (roomId, type, content, key) => {
                            SEV_ROOM_ID = roomId;
                            SEV_CONTENT = content;
                            SEV_KEY = key;
                            SEV_COUNT++;
                        },
                    };
                },
                join: (roomId) => {
                    JOIN_ROOM_ID = roomId;
                    JOINS++;
                },
                leave: (roomId) => {
                    LEAVE_ROOM_ID = roomId;
                    LEAVES++;
                },
                opts: {
                    backingStore: {
                        getMembership: (roomId, userId) => "join",
                        setMembership: (roomId, userId, membership) => { },
                    },
                },
                setAvatarUrl: async (ava) => {
                    AVATAR_SET = ava;
                },
                setDisplayName: async (dn) => {
                    DISPLAYNAME_SET = dn;
                },
            };
        },
    };
    const discordbot: any = {
        GetChannelFromRoomId: (id) => {
            if (id === "!found:localhost") {
                const guild = new MockGuild("666666");
                guild.members.set("123456", new MockMember("123456", "fella", guild));
                const chan = new MockChannel("543345", guild);
                guild.channels.set("543345", chan as any);
                return chan;
            }
            throw new Error("Channel not found");
        },
        GetGuilds: () => {
            return [];
        },
        GetIntentFromDiscordMember: (id) => {
            return bridge.getIntent(id);
        },
        GetRoomIdsFromGuild: async (guild, member?) => {
            if (member && member.roles.get("1234")) {
                return GUILD_ROOM_IDS_WITH_ROLE;
            }
            return GUILD_ROOM_IDS;
        },
    };
    REMOTEUSER_SET = null;
    LINK_RM_USER = null;
    LINK_MX_USER = null;
    const userStore = {
        getRemoteUser: (id) => remoteUsers.find((u) => u.id === id) || null,
        getRemoteUsersFromMatrixId: (id) => remoteUsers.filter((u) => u.id === id),
        linkUsers: (mxUser, remoteUser) => {
            LINK_MX_USER = mxUser;
            LINK_RM_USER = remoteUser;
        },
        setRemoteUser: async (remoteUser) => {
            REMOTEUSER_SET = remoteUser;
        },
    };
    const config = new DiscordBridgeConfig();
    config.bridge.domain = "localhost";
    config.ghosts = Object.assign({}, config.ghosts, ghostConfig);
    return new UserSync(bridge as Bridge, config, discordbot, userStore as any);
}

describe("UserSyncroniser", () => {
    describe("GetUserUpdateState", () => {
        it("Will create a new user", async () => {
            const userSync = CreateUserSync();
            const user = new MockUser(
                "123456",
                "TestUsername",
                "6969",
                "test.jpg",
                "111",
            );
            const state = await userSync.GetUserUpdateState(user as any);
            expect(state.createUser).is.true;
            expect(state.removeAvatar).is.false;
            expect(state.displayName).equals("TestUsername#6969");
            expect(state.mxUserId).equals("@_discord_123456:localhost");
            expect(state.avatarId).equals("111");
            expect(state.avatarUrl).equals("test.jpg");
        });
        it("Will change display names", async () => {
            const remoteUser = new RemoteUser("123456");
            remoteUser.avatarurl = "test.jpg";
            remoteUser.displayname = "TestUsername";

            const userSync = CreateUserSync([remoteUser]);
            const user = new MockUser(
                "123456",
                "TestUsername",
                "6969",
                "test.jpg",
                "111",
            );
            const state = await userSync.GetUserUpdateState(user as any);
            expect(state.createUser, "CreateUser").is.false;
            expect(state.removeAvatar, "RemoveAvatar").is.false;
            expect(state.displayName, "DisplayName").equals("TestUsername#6969");
            expect(state.mxUserId , "UserId").equals("@_discord_123456:localhost");
            expect(state.avatarId, "AvatarID").is.empty;
            expect(state.avatarUrl, "AvatarUrl").is.null;
        });
        it("Will obay name patterns", async () => {
            const remoteUser = new RemoteUser("123456");
            remoteUser.avatarurl = "test.jpg";
            remoteUser.displayname = "TestUsername";

            const userSync = CreateUserSync([remoteUser], {usernamePattern: ":username#:tag (Discord)"});
            const user = new MockUser(
                "123456",
                "TestUsername",
                "6969",
                "test.jpg",
                "111",
            );
            const state = await userSync.GetUserUpdateState(user as any);
            expect(state.createUser, "CreateUser").is.false;
            expect(state.removeAvatar, "RemoveAvatar").is.false;
            expect(state.displayName, "DisplayName").equals("TestUsername#6969 (Discord)");
            expect(state.mxUserId , "UserId").equals("@_discord_123456:localhost");
            expect(state.avatarId, "AvatarID").is.empty;
            expect(state.avatarUrl, "AvatarUrl").is.null;
        });
        it("Will change avatars", async () => {
            const remoteUser = new RemoteUser("123456");
            remoteUser.avatarurl = "test.jpg";
            remoteUser.displayname = "TestUsername#6969";

            const userSync = CreateUserSync([remoteUser]);
            const user = new MockUser(
                "123456",
                "TestUsername",
                "6969",
                "test2.jpg",
                "111",
            );
            const state = await userSync.GetUserUpdateState(user as any);
            expect(state.createUser, "CreateUser").is.false;
            expect(state.removeAvatar, "RemoveAvatar").is.false;
            expect(state.avatarUrl, "AvatarUrl").equals("test2.jpg");
            expect(state.mxUserId , "UserId").equals("@_discord_123456:localhost");
            expect(state.avatarId, "AvatarID").is.equals("111");
            expect(state.displayName, "DisplayName").is.null;
        });
        it("Will remove avatars", async () => {
            const remoteUser = new RemoteUser("123456");
            remoteUser.avatarurl = "test.jpg";
            remoteUser.displayname = "TestUsername#6969";

            const userSync = CreateUserSync([remoteUser]);
            const user = new MockUser(
                "123456",
                "TestUsername",
                "6969",
                null,
                null,
            );
            const state = await userSync.GetUserUpdateState(user as any);
            expect(state.createUser, "CreateUser").is.false;
            expect(state.removeAvatar, "RemoveAvatar").is.true;
            expect(state.avatarUrl, "AvatarUrl").is.null;
            expect(state.mxUserId , "UserId").equals("@_discord_123456:localhost");
            expect(state.avatarId, "AvatarID").is.empty;
            expect(state.displayName, "DisplayName").is.null;
        });
    });
    describe("ApplyStateToProfile", () => {
        it("Will create a new user", async () => {
            const userSync = CreateUserSync();
            const state: IUserState = {
                avatarId: "",
                avatarUrl: null, // Nullable
                createUser: true,
                displayName: null, // Nullable
                id: "123456",
                mxUserId: "@_discord_123456:localhost",
                removeAvatar: false,
            };
            await userSync.ApplyStateToProfile(state);
            expect(LINK_MX_USER).is.not.null;
            expect(LINK_RM_USER).is.not.null;
            expect(REMOTEUSER_SET).is.null;
        });
        it("Will set a display name", async () => {
            const userSync = CreateUserSync();
            const state: IUserState = {
                avatarId: "",
                avatarUrl: null, // Nullable
                createUser: true,
                displayName: "123456", // Nullable
                id: "123456",
                mxUserId: "@_discord_123456:localhost",
                removeAvatar: false,
            };
            await userSync.ApplyStateToProfile(state);
            expect(LINK_MX_USER).is.not.null;
            expect(LINK_RM_USER).is.not.null;
            expect(REMOTEUSER_SET).is.not.null;
            expect(DISPLAYNAME_SET).equal("123456");
            expect(REMOTEUSER_SET.displayname).equal("123456");
            expect(AVATAR_SET).is.null;
            expect(REMOTEUSER_SET.avatarurl).is.null;
        });
        it("Will set an avatar", async () => {
            const userSync = CreateUserSync();
            const state: IUserState = {
                avatarId: "",
                avatarUrl: "654321", // Nullable
                createUser: true,
                displayName: null, // Nullable
                id: "123456",
                mxUserId: "@_discord_123456:localhost",
                removeAvatar: false,
            };
            await userSync.ApplyStateToProfile(state);
            expect(LINK_MX_USER).is.not.null;
            expect(LINK_RM_USER).is.not.null;
            expect(AVATAR_SET).equal("avatarset");
            expect(UTIL_UPLOADED_AVATAR).to.be.true;
            expect(REMOTEUSER_SET).is.not.null;
            expect(REMOTEUSER_SET.avatarurl).equal("654321");
            expect(REMOTEUSER_SET.displayname).is.null;
            expect(DISPLAYNAME_SET).is.null;
        });
        it("Will remove an avatar", async () => {
            const userSync = CreateUserSync();
            const state: IUserState = {
                avatarId: "",
                avatarUrl: null, // Nullable
                createUser: true,
                displayName: null, // Nullable
                id: "123456",
                mxUserId: "@_discord_123456:localhost",
                removeAvatar: true,
            };
            await userSync.ApplyStateToProfile(state);
            expect(LINK_MX_USER).is.not.null;
            expect(LINK_RM_USER).is.not.null;
            expect(AVATAR_SET).is.null;
            expect(UTIL_UPLOADED_AVATAR).to.be.false;
            expect(REMOTEUSER_SET).is.not.null;
            expect(REMOTEUSER_SET.avatarurl).is.null;
            expect(REMOTEUSER_SET.displayname).is.null;
            expect(DISPLAYNAME_SET).is.null;
        });
        it("will do nothing if nothing needs to be done", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            const state: IUserState = {
                avatarId: "",
                avatarUrl: null, // Nullable
                createUser: false,
                displayName: null, // Nullable
                id: "123456",
                mxUserId: "@_discord_123456:localhost",
                removeAvatar: false,
            };
            await userSync.ApplyStateToProfile(state);
            expect(LINK_MX_USER).is.null;
            expect(LINK_RM_USER).is.null;
            expect(AVATAR_SET).is.null;
            expect(REMOTEUSER_SET).is.null;
            expect(DISPLAYNAME_SET).is.null;
        });
    });
    describe("ApplyStateToRoom", () => {
        it("Will apply a new nick", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            const state: IGuildMemberState = {
                bot: false,
                displayColor: 0,
                displayName: "Good Boy",
                id: "123456",
                mxUserId: "@_discord_123456:localhost",
                roles: [],
                username: "",
            };
            await userSync.ApplyStateToRoom(state, "!abc:localhost", "123456");
            expect(REMOTEUSER_SET).is.not.null;
            expect(REMOTEUSER_SET.guildNicks.get("123456")).is.equal("Good Boy");
            expect(SEV_ROOM_ID).is.equal("!abc:localhost");
            expect(SEV_CONTENT.displayname).is.equal("Good Boy");
            expect(SEV_KEY).is.equal("@_discord_123456:localhost");
        });
        it("Will not apply unchanged nick", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            const state: IGuildMemberState = {
                bot: false,
                displayColor: 0,
                displayName: "",
                id: "123456",
                mxUserId: "@_discord_123456:localhost",
                roles: [],
                username: "",
            };
            await userSync.ApplyStateToRoom(state, "!abc:localhost", "123456");
            expect(REMOTEUSER_SET).is.null;
            expect(SEV_ROOM_ID).is.null;
            expect(SEV_CONTENT).is.null;
            expect(SEV_KEY).is.null;
        });
        it("Will apply roles", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            const TESTROLE_NAME = "testrole";
            const TESTROLE_COLOR = 1337;
            const TESTROLE_POSITION = 42;
            const state: IGuildMemberState = {
                bot: false,
                displayColor: 0,
                displayName: "Good Boy",
                id: "123456",
                mxUserId: "@_discord_123456:localhost",
                roles: [
                    {
                        color: TESTROLE_COLOR,
                        name: TESTROLE_NAME,
                        position: TESTROLE_POSITION,
                    },
                ],
                username: "",
            };
            await userSync.ApplyStateToRoom(state, "!abc:localhost", "12345678");
            const custKey = SEV_CONTENT["uk.half-shot.discord.member"];
            const roles = custKey.roles;
            expect(custKey.id).is.equal("123456");
            expect(roles.length).is.equal(1);
            expect(roles[0].name).is.equal(TESTROLE_NAME);
            expect(roles[0].color).is.equal(TESTROLE_COLOR);
            expect(roles[0].position).is.equal(TESTROLE_POSITION);
        });
        it("Will set bot correctly", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            const state: IGuildMemberState = {
                bot: false,
                displayColor: 0,
                displayName: "Good Boy",
                id: "123456",
                mxUserId: "@_discord_123456:localhost",
                roles: [ ],
                username: "",
            };
            await userSync.ApplyStateToRoom(state, "!abc:localhost", "12345678");
            let custKey = SEV_CONTENT["uk.half-shot.discord.member"];
            expect(custKey.bot).is.false;

            state.bot = true;
            await userSync.ApplyStateToRoom(state, "!abc:localhost", "12345678");
            custKey = SEV_CONTENT["uk.half-shot.discord.member"];
            expect(custKey.bot).is.true;
        });
        it("Will set the displayColor correctly", async () => {
            const TEST_COLOR = 1234;
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            const state: IGuildMemberState = {
                bot: false,
                displayColor: TEST_COLOR,
                displayName: "Good Boy",
                id: "123456",
                mxUserId: "@_discord_123456:localhost",
                roles: [ ],
                username: "",
            };
            await userSync.ApplyStateToRoom(state, "!abc:localhost", "12345678");
            const custKey = SEV_CONTENT["uk.half-shot.discord.member"];
            expect(custKey.displayColor).is.equal(TEST_COLOR);
        });
        it("Will set username correctly", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            const state: IGuildMemberState = {
                bot: false,
                displayColor: 0,
                displayName: "Good Boy",
                id: "123456",
                mxUserId: "@_discord_123456:localhost",
                roles: [ ],
                username: "user#1234",
            };
            await userSync.ApplyStateToRoom(state, "!abc:localhost", "12345678");
            const custKey = SEV_CONTENT["uk.half-shot.discord.member"];
            expect(custKey.username).is.equal("user#1234");
        });
    });
    describe("GetUserStateForGuildMember", () => {
        it("Will apply a new nick", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            const guild = new MockGuild(
                "654321");
            const member = new MockMember(
                "123456",
                "username",
                guild,
                "BestDog");
            const state = await userSync.GetUserStateForGuildMember(member as any);
            expect(state.displayName).to.be.equal("BestDog");
        });
        it("Will will obay nick pattern", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")], { nickPattern: ":nick (Discord)" });
            const guild = new MockGuild(
                "654321");
            const member = new MockMember(
                "123456",
                "username",
                guild,
                "BestDog");
            const state = await userSync.GetUserStateForGuildMember(member as any);
            expect(state.displayName).to.be.equal("BestDog (Discord)");
        });
        it("Will correctly add roles", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            const guild = new MockGuild(
                "654321");
            const member = new MockMember(
                "123456",
                "username",
                guild,
                "BestDog");
            const TESTROLE_NAME = "testrole";
            const TESTROLE_COLOR = 1337;
            const TESTROLE_POSITION = 42;
            const role = new MockRole("123", TESTROLE_NAME, TESTROLE_COLOR, TESTROLE_POSITION);
            member.roles.set("123", role);
            const state = await userSync.GetUserStateForGuildMember(member as any);
            expect(state.roles.length).to.be.equal(1);
            expect(state.roles[0].name).to.be.equal(TESTROLE_NAME);
            expect(state.roles[0].color).to.be.equal(TESTROLE_COLOR);
            expect(state.roles[0].position).to.be.equal(TESTROLE_POSITION);
        });
    });
    describe("GetUserStateForDiscordUser", () => {
        it("Will apply a new nick", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            const member = new MockUser(
                "123456",
                "username",
                "1234");
            const state = await userSync.GetUserStateForDiscordUser(member as any);
            expect(state.displayName).to.be.equal("username");
        });
        it("Will handle webhooks", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            const member = new MockUser(
                "123456",
                "username",
                "1234");
            const state = await userSync.GetUserStateForDiscordUser(member as any, "654321");
            expect(state.displayName).to.be.equal("username");
            expect(state.mxUserId).to.be.equal("@_discord_123456_username:localhost");
        });
    });
    describe("OnAddGuildMember", () => {
        it("will update user and join to rooms", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            const guild = new MockGuild(
                "654321");
            const member = new MockMember(
                "123456",
                "username",
                guild);
            await userSync.OnAddGuildMember(member as any);
            expect(SEV_COUNT).to.equal(GUILD_ROOM_IDS.length);
        });
    });
    describe("OnRemoveGuildMember", () => {
        it("will leave users from rooms", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            const guild = new MockGuild(
                "654321");
            const member = new MockMember(
                "123456",
                "username",
                guild);
            await userSync.OnRemoveGuildMember(member as any);
            expect(LEAVES).to.equal(GUILD_ROOM_IDS.length);
        });
    });
    describe("OnUpdateGuildMember", () => {
        it("will update state for rooms", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            const guild = new MockGuild(
                "654321");
            const newMember = new MockMember(
                "123456",
                "username",
                guild,
                "FiddleDee");
            await userSync.OnUpdateGuildMember(newMember as any);
            expect(SEV_COUNT).to.equal(GUILD_ROOM_IDS.length);
        });
        it("will part rooms based on role removal", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            const role = new MockRole("1234", "role");
            const guild = new MockGuild(
                "654321");
            const newMember = new MockMember(
                "123456",
                "username",
                guild,
                "FiddleDee");
            newMember.roles.set("1234", role);
            await userSync.OnUpdateGuildMember(newMember as any);
            expect(SEV_COUNT).to.equal(GUILD_ROOM_IDS_WITH_ROLE.length);
            expect(LEAVES).to.equal(GUILD_ROOM_IDS.length - GUILD_ROOM_IDS_WITH_ROLE.length);
            expect(LEAVE_ROOM_ID).to.equal("!ghi:localhost");
        });
    });
});
