import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import { Bridge, RemoteUser } from "matrix-appservice-bridge";
import {IUserState, UserSyncroniser} from "../src/usersyncroniser";
import {MockUser} from "./mocks/user";
import {DiscordBridgeConfig} from "../src/config";
import * as Proxyquire from "proxyquire";

Chai.use(ChaiAsPromised);
const expect = Chai.expect;

let DISPLAYNAME_SET = null;
let AVATAR_SET = null;
let REMOTEUSER_SET = null;
let INTENT_ID = null;
let LINK_MX_USER = null;
let LINK_RM_USER = null;
let UTIL_UPLOADED_AVATAR = false;

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
            return {
                setDisplayName: (dn) => {
                    DISPLAYNAME_SET = dn;
                    return Promise.resolve();
                },
                setAvatarUrl: (ava) => {
                    AVATAR_SET = ava;
                    return Promise.resolve();
                },
            };
        },
    };
    const config = new DiscordBridgeConfig();
    config.bridge.domain = "localhost";
    return new UserSync(bridge as Bridge, config);
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
           return userSync.GetUserUpdateState(null, user as any).then((state) => {
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
           return userSync.GetUserUpdateState(null, user as any).then((state) => {
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
           return userSync.GetUserUpdateState(null, user as any).then((state) => {
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
           return userSync.GetUserUpdateState(null, user as any).then((state) => {
               expect(state.createUser, "CreateUser").is.false;
               expect(state.removeAvatar, "RemoveAvatar").is.true;
               expect(state.avatarUrl, "AvatarUrl").is.null;
               expect(state.mxUserId , "UserId").equals("@_discord_123456:localhost");
               expect(state.avatarId, "AvatarID").is.null;
               expect(state.displayName, "DisplayName").is.null;
           });
       });
   });
   describe("ApplyUserState", () => {
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
           return userSync.ApplyUserState(state).then(() => {
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
           return userSync.ApplyUserState(state).then(() => {
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
           return userSync.ApplyUserState(state).then(() => {
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
           return userSync.ApplyUserState(state).then(() => {
               expect(LINK_MX_USER).is.null;
               expect(LINK_RM_USER).is.null;
               expect(AVATAR_SET).is.null;
               expect(REMOTEUSER_SET).is.null;
               expect(DISPLAYNAME_SET).is.null;
           });
       });
   });
});
