import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import { Bridge, RemoteUser } from "matrix-appservice-bridge";
import {IGuildMemberState, IUserState, UserSyncroniser} from "../src/usersyncroniser";
import {MockUser} from "./mocks/user";
import {DiscordBridgeConfig} from "../src/config";
import * as Proxyquire from "proxyquire";
import {MockMember} from "./mocks/member";
import {MockGuild} from "./mocks/guild";
import { MockChannel } from "./mocks/channel";
import { IMatrixEvent } from "../src/util";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

Chai.use(ChaiAsPromised);
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

const UserSync = (Proxyquire("../src/usersyncroniser", {
    "./util": {
        Util: {
            UploadContentFromUrl: async () => {
                UTIL_UPLOADED_AVATAR = true;
                return {mxcUrl: "avatarset"};
            },
        },
    },
})).UserSyncroniser;

function CreateUserSync(remoteUsers: any[] = []): UserSyncroniser {
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
                setAvatarUrl: async (ava) => {
                    AVATAR_SET = ava;
                },
                setDisplayName: async (dn) => {
                    DISPLAYNAME_SET = dn;
                },
            };
        },
        getUserStore: () => {
            REMOTEUSER_SET = null;
            LINK_RM_USER = null;
            LINK_MX_USER = null;
            return {
                getRemoteUser: (id) => {
                    const user = remoteUsers.find((u) => u.id === id);
                    if (user === undefined) {
                        return null;
                    }
                    return user;
                },
                getRemoteUsersFromMatrixId: (id) => {
                    return remoteUsers.filter((u) => u.id === id);
                },
                linkUsers: (mxUser, remoteUser) => {
                    LINK_MX_USER = mxUser;
                    LINK_RM_USER = remoteUser;
                },
                setRemoteUser: async (remoteUser) => {
                    REMOTEUSER_SET = remoteUser;
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
        GetRoomIdsFromGuild: async () => {
            return GUILD_ROOM_IDS;
        },
    };
    const config = new DiscordBridgeConfig();
    config.bridge.domain = "localhost";
    return new UserSync(bridge as Bridge, config, discordbot);
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
            return userSync.GetUserUpdateState(user as any).then((state) => {
                expect(state.createUser).is.true;
                expect(state.removeAvatar).is.false;
                expect(state.displayName).equals("TestUsername#6969");
                expect(state.mxUserId).equals("@_discord_123456:localhost");
                expect(state.avatarId).equals("111");
                expect(state.avatarUrl).equals("test.jpg");
            });
        });
        it("Will change display names", async () => {
            const remoteUser = new RemoteUser("123456", {
                avatarurl: "test.jpg",
                displayname: "MrFake",
            });

            const userSync = CreateUserSync([remoteUser]);
            const user = new MockUser(
                "123456",
                "TestUsername",
                "6969",
                "test.jpg",
                "111",
            );
            return userSync.GetUserUpdateState(user as any).then((state) => {
                expect(state.createUser, "CreateUser").is.false;
                expect(state.removeAvatar, "RemoveAvatar").is.false;
                expect(state.displayName, "DisplayName").equals("TestUsername#6969");
                expect(state.mxUserId , "UserId").equals("@_discord_123456:localhost");
                expect(state.avatarId, "AvatarID").is.empty;
                expect(state.avatarUrl, "AvatarUrl").is.null;
            });
        });
        it("Will change avatars", async () => {
            const remoteUser = new RemoteUser("123456", {
                avatarurl: "test.jpg",
                displayname: "TestUsername#6969",
            });

            const userSync = CreateUserSync([remoteUser]);
            const user = new MockUser(
                "123456",
                "TestUsername",
                "6969",
                "test2.jpg",
                "111",
            );
            return userSync.GetUserUpdateState(user as any).then((state) => {
                expect(state.createUser, "CreateUser").is.false;
                expect(state.removeAvatar, "RemoveAvatar").is.false;
                expect(state.avatarUrl, "AvatarUrl").equals("test2.jpg");
                expect(state.mxUserId , "UserId").equals("@_discord_123456:localhost");
                expect(state.avatarId, "AvatarID").is.equals("111");
                expect(state.displayName, "DisplayName").is.null;
            });
        });
        it("Will remove avatars", async () => {
            const remoteUser = new RemoteUser("123456", {
                avatarurl: "test.jpg",
                displayname: "TestUsername#6969",
            });

            const userSync = CreateUserSync([remoteUser]);
            const user = new MockUser(
                "123456",
                "TestUsername",
                "6969",
                null,
                null,
            );
            return userSync.GetUserUpdateState(user as any).then((state) => {
                expect(state.createUser, "CreateUser").is.false;
                expect(state.removeAvatar, "RemoveAvatar").is.true;
                expect(state.avatarUrl, "AvatarUrl").is.null;
                expect(state.mxUserId , "UserId").equals("@_discord_123456:localhost");
                expect(state.avatarId, "AvatarID").is.empty;
                expect(state.displayName, "DisplayName").is.null;
            });
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
            return userSync.ApplyStateToProfile(state).then(() => {
                expect(LINK_MX_USER).is.not.null;
                expect(LINK_RM_USER).is.not.null;
                expect(REMOTEUSER_SET).is.null;
            });
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
            return userSync.ApplyStateToProfile(state).then(() => {
                expect(LINK_MX_USER).is.not.null;
                expect(LINK_RM_USER).is.not.null;
                expect(REMOTEUSER_SET).is.not.null;
                expect(DISPLAYNAME_SET).equal("123456");
                expect(REMOTEUSER_SET.data.displayname).equal("123456");
                expect(AVATAR_SET).is.null;
                expect(REMOTEUSER_SET.data.avatarurl).is.undefined;
            });
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
            return userSync.ApplyStateToProfile(state).then(() => {
                expect(LINK_MX_USER).is.not.null;
                expect(LINK_RM_USER).is.not.null;
                expect(AVATAR_SET).equal("avatarset");
                expect(UTIL_UPLOADED_AVATAR).to.be.true;
                expect(REMOTEUSER_SET).is.not.null;
                expect(REMOTEUSER_SET.data.avatarurl).equal("654321");
                expect(REMOTEUSER_SET.data.displayname).is.undefined;
                expect(DISPLAYNAME_SET).is.null;
            });
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
            return userSync.ApplyStateToProfile(state).then(() => {
                expect(LINK_MX_USER).is.not.null;
                expect(LINK_RM_USER).is.not.null;
                expect(AVATAR_SET).is.null;
                expect(UTIL_UPLOADED_AVATAR).to.be.false;
                expect(REMOTEUSER_SET).is.not.null;
                expect(REMOTEUSER_SET.data.avatarurl).is.null;
                expect(REMOTEUSER_SET.data.displayname).is.undefined;
                expect(DISPLAYNAME_SET).is.null;
            });
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
            return userSync.ApplyStateToProfile(state).then(() => {
                expect(LINK_MX_USER).is.null;
                expect(LINK_RM_USER).is.null;
                expect(AVATAR_SET).is.null;
                expect(REMOTEUSER_SET).is.null;
                expect(DISPLAYNAME_SET).is.null;
            });
        });
    });
    describe("ApplyStateToRoom", () => {
        it("Will apply a new nick", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            const state: IGuildMemberState = {
                displayName: "Good Boy",
                id: "123456",
                mxUserId: "@_discord_123456:localhost",
                roles: [],
            };
            return userSync.ApplyStateToRoom(state, "!abc:localhost", "123456").then(() => {
                expect(REMOTEUSER_SET).is.not.null;
                expect(REMOTEUSER_SET.data.nick_123456).is.equal("Good Boy");
                expect(SEV_ROOM_ID).is.equal("!abc:localhost");
                expect(SEV_CONTENT.displayname).is.equal("Good Boy");
                expect(SEV_KEY).is.equal("@_discord_123456:localhost");
            });
        });
        it("Will not apply unchanged nick", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            const state: IGuildMemberState = {
                displayName: "",
                id: "123456",
                mxUserId: "@_discord_123456:localhost",
                roles: [],
            };
            return userSync.ApplyStateToRoom(state, "!abc:localhost", "123456").then(() => {
                expect(REMOTEUSER_SET).is.null;
                expect(SEV_ROOM_ID).is.null;
                expect(SEV_CONTENT).is.null;
                expect(SEV_KEY).is.null;
            });
        });
        it("Will apply roles", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            const TESTROLE_NAME = "testrole";
            const TESTROLE_COLOR = 1337;
            const TESTROLE_POSITION = 42;
            const state: IGuildMemberState = {
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
            };
            return userSync.ApplyStateToRoom(state, "!abc:localhost", "12345678").then(() => {
                const custKey = SEV_CONTENT["uk.half-shot.discord.member"];
                const roles = custKey.roles;
                expect(custKey.id).is.equal("123456");
                expect(roles.length).is.equal(1);
                expect(roles[0].name).is.equal(TESTROLE_NAME);
                expect(roles[0].color).is.equal(TESTROLE_COLOR);
                expect(roles[0].position).is.equal(TESTROLE_POSITION);
            });
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
        it("Will not apply if the nick has already been set", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            const guild = new MockGuild(
                "654321");
            const member = new MockMember(
                "123456",
                "username",
                guild,
                "BestDog");
            return userSync.GetUserStateForGuildMember(member as any, "BestDog").then((state) => {
                expect(state.displayName).is.empty;
            });
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
            member.roles = [
                {
                    color: TESTROLE_COLOR,
                    name: TESTROLE_NAME,
                    position: TESTROLE_POSITION,
                },
            ];
            return userSync.GetUserStateForGuildMember(member as any).then((state) => {
                expect(state.roles.length).to.be.equal(1);
                expect(state.roles[0].name).to.be.equal(TESTROLE_NAME);
                expect(state.roles[0].color).to.be.equal(TESTROLE_COLOR);
                expect(state.roles[0].position).to.be.equal(TESTROLE_POSITION);
            });
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
            return userSync.OnAddGuildMember(member as any).then(() => {
                expect(JOINS).to.equal(GUILD_ROOM_IDS.length);
            });
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
             return userSync.OnRemoveGuildMember(member as any).then(() => {
                 expect(LEAVES).to.equal(GUILD_ROOM_IDS.length);
             });
         });
    });
    describe("OnUpdateGuildMember", () => {
        it("will update state for rooms", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            const guild = new MockGuild(
                "654321");
            const oldMember = new MockMember(
                "123456",
                "username",
                guild);
            const newMember = new MockMember(
                "123456",
                "username",
                guild,
                "FiddleDee");
            return userSync.OnUpdateGuildMember(oldMember as any, newMember as any).then(() => {
                expect(SEV_COUNT).to.equal(GUILD_ROOM_IDS.length);
            });
        });
        it("will not update state for unchanged member", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            const guild = new MockGuild(
                "654321");
            const oldMember = new MockMember(
                "123456",
                "username",
                guild,
                "FiddleDee");
            const newMember = new MockMember(
                "123456",
                "username",
                guild,
                "FiddleDee");
            return userSync.OnUpdateGuildMember(oldMember as any, newMember as any).then(() => {
                expect(SEV_COUNT).to.equal(0);
            });
        });
    });
    describe("OnMemberState", () => {
        it("will update state for rooms", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            return userSync.OnMemberState({
                content: {

                },
                room_id: "!found:localhost",
                state_key: "123456",
            } as IMatrixEvent, 0).then(() => {
                 expect(SEV_COUNT).to.equal(1);
            });
        });
        it("will not update state for a unknown user", async () => {
            const userSync = CreateUserSync([]);
            return expect(userSync.OnMemberState({
                content: {

                },
                room_id: "!abcdef:localhost",
                state_key: "123456",
            } as IMatrixEvent, 0)).to.eventually.equal(UserSyncroniser.ERR_USER_NOT_FOUND);
        });
        it("will not update state for a unknown room", async () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            return expect(userSync.OnMemberState({
                content: {

                },
                room_id: "!notfound:localhost",
                state_key: "123456",
            } as IMatrixEvent, 0)).to.eventually.equal(UserSyncroniser.ERR_CHANNEL_MEMBER_NOT_FOUND);
        });
        it("will not update state for a member not found in the channel", async () => {
            const userSync = CreateUserSync([new RemoteUser("111222")]);
            return expect(userSync.OnMemberState({
                content: {

                },
                room_id: "!found:localhost",
                state_key: "111222",
            } as IMatrixEvent, 0)).to.eventually.equal(UserSyncroniser.ERR_CHANNEL_MEMBER_NOT_FOUND);
        });
        it("will not process old events", async () => {
            const DELAY_MS = 250;
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            return Promise.all([
                expect(userSync.OnMemberState({
                    content: { },
                    event_id: "Anicent:localhost",
                    origin_server_ts: 10000,
                    room_id: "!found:localhost",
                    state_key: "123456",
                } as IMatrixEvent, DELAY_MS))
                    .to.eventually.equal(UserSyncroniser.ERR_NEWER_EVENT, "State 1 Failed"),
                expect(userSync.OnMemberState({
                    content: { },
                    event_id: "QuiteOld:localhost",
                    origin_server_ts: 7000,
                    room_id: "!found:localhost",
                    state_key: "123456",
                } as IMatrixEvent, DELAY_MS)).to.eventually.equal(UserSyncroniser.ERR_NEWER_EVENT, "State 2 Failed"),
                expect(userSync.OnMemberState({
                    content: { },
                    event_id: "FreshEnough:localhost",
                    origin_server_ts: 3000,
                    room_id: "!found:localhost",
                    state_key: "123456",
                } as IMatrixEvent, DELAY_MS)).to.eventually.equal(UserSyncroniser.ERR_NEWER_EVENT, "State 3 Failed"),
                expect(userSync.OnMemberState({
                    content: { },
                    event_id: "GettingOnABit:localhost",
                    origin_server_ts: 4000,
                    room_id: "!found:localhost",
                    state_key: "123456",
                } as IMatrixEvent, DELAY_MS)).to.eventually.equal(UserSyncroniser.ERR_NEWER_EVENT, "State 4 Failed"),
                expect(userSync.OnMemberState({
                    content: { },
                    event_id: "FreshOutTheOven:localhost",
                    origin_server_ts: 100,
                    room_id: "!found:localhost",
                    state_key: "123456",
                } as IMatrixEvent, DELAY_MS)).to.eventually.be.fulfilled,
            ]);
        });
    });
    // TODO: Add test to ensure onMemberState doesn't recurse.
});
