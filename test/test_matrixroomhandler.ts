import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import * as Proxyquire from "proxyquire";
import {DiscordBridgeConfig} from "../src/config";
import {MockDiscordClient} from "./mocks/discordclient";
import * as log from "npmlog";
import {PresenceHandler} from "../src/presencehandler";
import {DiscordBot} from "../src/bot";
import {MatrixRoomHandler} from "../src/matrixroomhandler";
import {MockChannel} from "./mocks/channel";
import {MockMember} from "./mocks/member";

Chai.use(ChaiAsPromised);
const expect = Chai.expect;

// const DiscordClientFactory = Proxyquire("../src/clientfactory", {
//     "discord.js": { Client: require("./mocks/discordclient").MockDiscordClient },
// }).DiscordClientFactory;

let USERSJOINED = 0;

function createRH(opts: any = {}) {
    USERSJOINED = 0;
    const bot = {
        GetChannelFromRoomId: (roomid: string) => {
            if (roomid === "!accept:localhost") {
                const chan = new MockChannel();
                if (opts.createMembers) {
                    chan.members.set("12345", new MockMember("12345", "testuser1"));
                    chan.members.set("54321", new MockMember("54321", "testuser2"));
                    chan.members.set("bot12345", new MockMember("bot12345", "botuser"));
                }
                return Promise.resolve(chan);
            } else {
                return Promise.reject("Roomid not found");
            }
        },
        InitJoinUser: (member: MockMember, roomids: string[]) => {
                if (opts.failUser) {
                    return Promise.reject("test is rejecting joins");
                }
                USERSJOINED++;
                return Promise.resolve();

        },
        GetBotId: () => "bot12345",
    };
    const config = new DiscordBridgeConfig();
    config.limits.roomGhostJoinDelay = 0;
    const provisioner = null;
    return new MatrixRoomHandler(bot as any, config, "@botuser:localhost", provisioner);
}

describe("MatrixRoomHandler", () => {
    describe("OnAliasQueried", () => {
        it("should join successfully", () => {
            const handler = createRH();
            return handler.OnAliasQueried("#accept:localhost", "!accept:localhost")
                .then(() => {
                    // test for something
                    return true;
            });
        });
        it("should join successfully and create ghosts", () => {
            const EXPECTEDUSERS = 2;
            const handler = createRH({createMembers: true});
            return handler.OnAliasQueried("#accept:localhost", "!accept:localhost")
                .then(() => {
                    expect(USERSJOINED).to.equal(EXPECTEDUSERS);
                    // test for something
                    return true;
                });
        });
    });
});
