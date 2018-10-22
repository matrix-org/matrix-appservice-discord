import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import * as Proxyquire from "proxyquire";
import { Provisioner } from "../src/provisioner";
import { MockChannel } from "./mocks/channel";
import { MockGuild } from "./mocks/guild";
import { RoomBridgeStore } from "matrix-appservice-bridge";

Chai.use(ChaiAsPromised);
const expect = Chai.expect;

let provisoner: Provisioner;
let linkedLocal = null;
let linkedRemote = null;
let setMatrixRoom = null;
describe("Provisoner", () => {
    beforeEach(() => {
        linkedLocal = null;
        linkedRemote = null;
        provisoner = new Provisioner();
        const roomStore = {
            linkRooms: (local, remote) => {
                linkedLocal = local;
                linkedRemote = remote;
            },
            setMatrixRoom: (local) => {
                setMatrixRoom = local;
            },
        };
        provisoner.SetBridge({
            getRoomStore: () => roomStore,
        });
    });

    describe("BridgeMatrixRoom", () => {
        it("should store and link the room", () => {
            let chan = new MockChannel("123", new MockGuild("456"));
            provisoner.BridgeMatrixRoom(chan as any, "!abcdef:localhost");
        });
    });

    describe("AskBridgePermission", () => {
        it("should store and link the room", () => {
            let chan = new MockChannel("123", new MockGuild("456"));
            provisoner.BridgeMatrixRoom(chan as any, "!abcdef:localhost");
        });
    });
});
