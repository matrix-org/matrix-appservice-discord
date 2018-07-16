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

Chai.use(ChaiAsPromised);
const expect = Chai.expect;

let DISPLAYNAME_SET = null;
let AVATAR_SET = null;
let REMOTEUSER_SET = null;
let INTENT_ID = null;
let LINK_MX_USER = null;
let LINK_RM_USER = null;
let UTIL_UPLOADED_AVATAR = false;

let SEV_ROOM_ID = null;
let SEV_CONTENT = null;
let SEV_KEY = null;
let JOIN_ROOM_ID = null;
let LEAVE_ROOM_ID = null;
let JOINS = 0;
let LEAVES = 0;
let SEV_COUNT = 0;

const GUILD_ROOM_IDS = ["!abc:localhost", "!def:localhost", "!ghi:localhost"];

const UserSync = (Proxyquire("../src/usersyncroniser", {
    "./util": {
        Util: {
            UploadContentFromUrl: () => {
                UTIL_UPLOADED_AVATAR = true;
                return Promise.resolve({mxcUrl: "avatarset"});
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
                setRemoteUser: (remoteUser) => {
                    REMOTEUSER_SET = remoteUser;
                    return Promise.resolve();
                },
                linkUsers: (mxUser, remoteUser) => {
                    LINK_MX_USER = mxUser;
                    LINK_RM_USER = remoteUser;
                },
            };
        },
        getIntent: (id) => {
            DISPLAYNAME_SET = null;
            AVATAR_SET = null;
            INTENT_ID = id;
            JOIN_ROOM_ID = null;
            JOINS = 0;
            LEAVES = 0;
            return {
                join: (roomId) => {
                    JOIN_ROOM_ID = roomId;
                    JOINS++;
                },
                leave: (roomId) => {
                    LEAVE_ROOM_ID = roomId;
                    LEAVES++;
                },
                setDisplayName: (dn) => {
                    DISPLAYNAME_SET = dn;
                    return Promise.resolve();
                },
                setAvatarUrl: (ava) => {
                    AVATAR_SET = ava;
                    return Promise.resolve();
                },
                sendStateEvent: (roomId, type, key, content) => {
                    SEV_ROOM_ID = roomId;
                    SEV_CONTENT = content;
                    SEV_KEY = key;
                    SEV_COUNT++;
                },
            };
        },
    };
    const discordbot: any = {
        GetRoomIdsFromGuild: () => {
            return Promise.resolve(GUILD_ROOM_IDS);
        },
        GetIntentFromDiscordMember: (id) => {
            return bridge.getIntent(id);
        },
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
    };
    const config = new DiscordBridgeConfig();
    config.bridge.domain = "localhost";
    return new UserSync(bridge as Bridge, config, discordbot);
}

describe("UserSyncroniser", () => {
   describe("GetUserUpdateState", () => {
       it("Will create new users", () => {
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
       it("Will change display names", () => {
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
               expect(state.avatarId, "AvatarID").is.null;
               expect(state.avatarUrl, "AvatarUrl").is.null;
           });
       });
       it("Will change avatars", () => {
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
       it("Will remove avatars", () => {
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
               expect(state.avatarId, "AvatarID").is.null;
               expect(state.displayName, "DisplayName").is.null;
           });
       });
   });
   describe("ApplyStateToProfile", () => {
       it("Will create a new user", () => {
           const userSync = CreateUserSync();
           const state: IUserState = {
               id: "123456",
               createUser: true,
               mxUserId: "@_discord_123456:localhost",
               displayName: null, // Nullable
               avatarUrl: null, // Nullable
               avatarId: null,
               removeAvatar: false,
           };
           return userSync.ApplyStateToProfile(state).then(() => {
               expect(LINK_MX_USER).is.not.null;
               expect(LINK_RM_USER).is.not.null;
               expect(REMOTEUSER_SET).is.null;
           });
       });
       it("Will set a display name", () => {
           const userSync = CreateUserSync();
           const state: IUserState = {
               id: "123456",
               createUser: true,
               mxUserId: "@_discord_123456:localhost",
               displayName: "123456", // Nullable
               avatarUrl: null, // Nullable
               avatarId: null,
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
       it("Will set an avatar", () => {
           const userSync = CreateUserSync();
           const state: IUserState = {
               id: "123456",
               createUser: true,
               mxUserId: "@_discord_123456:localhost",
               displayName: null, // Nullable
               avatarUrl: "654321", // Nullable
               avatarId: null,
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
       it("Will remove an avatar", () => {
           const userSync = CreateUserSync();
           const state: IUserState = {
               id: "123456",
               createUser: true,
               mxUserId: "@_discord_123456:localhost",
               displayName: null, // Nullable
               avatarUrl: null, // Nullable
               avatarId: null,
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
       it("Will fetch an existing user", () => {
           const userSync = CreateUserSync([new RemoteUser("123456")]);
           const state: IUserState = {
               id: "123456",
               createUser: false,
               mxUserId: "@_discord_123456:localhost",
               displayName: null, // Nullable
               avatarUrl: null, // Nullable
               avatarId: null,
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
       it("Will apply a new nick", () => {
           const userSync = CreateUserSync([new RemoteUser("123456")]);
           const state: IGuildMemberState = {
               id: "123456",
               mxUserId: "@_discord_123456:localhost",
               displayName: "Good Boy",
           };
           return userSync.ApplyStateToRoom(state, "!abc:localhost", "123456").then(() => {
               expect(REMOTEUSER_SET).is.not.null;
               expect(REMOTEUSER_SET.data.nick_123456).is.equal("Good Boy");
               expect(SEV_ROOM_ID).is.equal("!abc:localhost");
               expect(SEV_CONTENT.displayname).is.equal("Good Boy");
               expect(SEV_KEY).is.equal("@_discord_123456:localhost");
           });
       });
       it("Will not apply unchanged nick", () => {
           const userSync = CreateUserSync([new RemoteUser("123456")]);
           const state: IGuildMemberState = {
               id: "123456",
               mxUserId: "@_discord_123456:localhost",
               displayName: null,
           };
           return userSync.ApplyStateToRoom(state, "!abc:localhost", "123456").then(() => {
               expect(REMOTEUSER_SET).is.null;
               expect(SEV_ROOM_ID).is.null;
               expect(SEV_CONTENT).is.null;
               expect(SEV_KEY).is.null;
           });
       });
   });
   describe("GetUserStateForGuildMember", () => {
       it("Will apply a new nick", () => {
           const userSync = CreateUserSync([new RemoteUser("123456")]);
           const guild = new MockGuild(
               "654321");
           const member = new MockMember(
               "123456",
               "username",
               guild,
               "BestDog");
           return userSync.GetUserStateForGuildMember(member as any, null).then((state) => {
               expect(state.displayName).to.be.equal("BestDog");
           });
       });
       it("Will not apply if the nick has already been set", () => {
           const userSync = CreateUserSync([new RemoteUser("123456")]);
           const guild = new MockGuild(
               "654321");
           const member = new MockMember(
               "123456",
               "username",
               guild,
               "BestDog");
           return userSync.GetUserStateForGuildMember(member as any, "BestDog").then((state) => {
               expect(state.displayName).is.null;
           });
       });
   });
   describe("OnAddGuildMember", () => {
       it("will update user and join to rooms", () => {
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
        it("will leave users from rooms", () => {
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
        it("will update state for rooms", () => {
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
        it("will not update state for unchanged member", () => {
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
       it("will update state for rooms", () => {
           const userSync = CreateUserSync([new RemoteUser("123456")]);
           return userSync.OnMemberState({
               content: {

               },
               room_id: "!found:localhost",
               state_key: "123456",
           }, 0).then(() => {
                expect(SEV_COUNT).to.equal(1);
           });
       });
       it("will not update state for a unknown user", () => {
           const userSync = CreateUserSync([]);
           return expect(userSync.OnMemberState({
               content: {

               },
               room_id: "!abcdef:localhost",
               state_key: "123456",
            }, 0)).to.eventually.equal(UserSyncroniser.ERR_USER_NOT_FOUND);
       });
       it("will not update state for a unknown room", () => {
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            return expect(userSync.OnMemberState({
               content: {

               },
               room_id: "!notfound:localhost",
               state_key: "123456",
            }, 0)).to.eventually.equal(UserSyncroniser.ERR_CHANNEL_MEMBER_NOT_FOUND);
       });
       it("will not update state for a member not found in the channel", () => {
            const userSync = CreateUserSync([new RemoteUser("111222")]);
            return expect(userSync.OnMemberState({
               content: {

               },
               room_id: "!found:localhost",
               state_key: "111222",
            }, 0)).to.eventually.equal(UserSyncroniser.ERR_CHANNEL_MEMBER_NOT_FOUND);
       });
       it("will not process old events", () => {
            const DELAY_MS = 250;
            const userSync = CreateUserSync([new RemoteUser("123456")]);
            return Promise.all([
                expect(userSync.OnMemberState({
                    origin_server_ts: 10000,
                    content: {

                    },
                    event_id: "Anicent:localhost",
                    room_id: "!found:localhost",
                    state_key: "123456",
                }, DELAY_MS)).to.eventually.equal(UserSyncroniser.ERR_NEWER_EVENT, "State 1 Failed"),
                expect(userSync.OnMemberState({
                    origin_server_ts: 7000,
                    content: {

                    },
                    event_id: "QuiteOld:localhost",
                    room_id: "!found:localhost",
                    state_key: "123456",
                }, DELAY_MS)).to.eventually.equal(UserSyncroniser.ERR_NEWER_EVENT, "State 2 Failed"),
                expect(userSync.OnMemberState({
                    origin_server_ts: 3000,
                    content: {

                    },
                    event_id: "FreshEnough:localhost",
                    room_id: "!found:localhost",
                    state_key: "123456",
                }, DELAY_MS)).to.eventually.equal(UserSyncroniser.ERR_NEWER_EVENT, "State 3 Failed"),
                expect(userSync.OnMemberState({
                    origin_server_ts: 4000,
                    content: {

                    },
                    event_id: "GettingOnABit:localhost",
                    room_id: "!found:localhost",
                    state_key: "123456",
                }, DELAY_MS)).to.eventually.equal(UserSyncroniser.ERR_NEWER_EVENT, "State 4 Failed"),
                expect(userSync.OnMemberState({
                    origin_server_ts: 100,
                    content: {

                    },
                    event_id: "FreshOutTheOven:localhost",
                    room_id: "!found:localhost",
                    state_key: "123456",
                }, DELAY_MS)).to.eventually.be.fulfilled,
            ]);
       });
   });
    // TODO: Add test to ensure onMemberState doesn't recurse.
});
