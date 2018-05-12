import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import { Bridge, RemoteUser } from "matrix-appservice-bridge";
import {UserSyncroniser} from "../src/usersyncroniser";
import {MockUser} from "./mocks/user";
import {DiscordBridgeConfig} from "../src/config";

Chai.use(ChaiAsPromised);
const expect = Chai.expect;

function CreateUserSync(remoteUsers: any[] = []): UserSyncroniser {
    const bridge: any = {
        getUserStore: () => {
            return {
                getRemoteUser: (id) => {
                    const user = remoteUsers.find((u) => u.id === id);
                    if (user === undefined) {
                        return null;
                    }
                    return user;
                },
            };
        },
    };
    const config = new DiscordBridgeConfig();
    config.bridge.domain = "localhost";
    return new UserSyncroniser(bridge as Bridge, config);
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
       it("Will set a display name", () => {

       });
       it("Will set a avatar", () => {

       });
   });
});
