import * as Chai from "chai";

import { Util, ICommandAction, ICommandParameters } from "../src/util";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

const expect = Chai.expect;

function CreateMockIntent(members) {
    return {
        getClient: () => {
            return {
                _http: {
                    authedRequestWithPrefix: async (_, __, url, ___, ____, _____) => {
                        const ret: any[] = [];
                        for (const member of members[url]) {
                            ret.push({
                                content: {
                                    displayname: member.displayname,
                                },
                                membership: member.membership,
                                state_key: member.mxid,
                            });
                        }
                        return {
                            chunk: ret,
                        };
                    },
                },
            };
        },
    };
}

describe("Util", () => {
    describe("MsgToArgs", () => {
        it("parses arguments", () => {
            const {command, args} = Util.MsgToArgs("!matrix command arg1 arg2", "!matrix");
            Chai.assert.equal(command, "command");
            // tslint:disable-next-line:no-magic-numbers
            Chai.assert.equal(args.length, 2);
            Chai.assert.equal(args[0], "arg1");
            Chai.assert.equal(args[1], "arg2");
        });
    });
    describe("ParseCommand", () => {
        it("parses commands", async () => {
            const action: ICommandAction = {
                params: ["param1", "param2"],
                run: async ({param1, param2}) => {
                    return `param1: ${param1}\nparam2: ${param2}`;
                },
            };
            const parameters: ICommandParameters = {
                param1: {
                    get: async (param: string) => {
                        return "param1_" + param;
                    },
                },
                param2: {
                    get: async (param: string) => {
                        return "param2_" + param;
                    },
                },
            };
            const retStr = await Util.ParseCommand(action, parameters, ["hello", "world"]);
            expect(retStr).equal("param1: param1_hello\nparam2: param2_world");
        });
    });
    describe("GetMxidFromName", () => {
        it("Finds a single member", async () => {
            const mockRooms = {
                "/rooms/abc/members": [
                    {
                        displayname: "GoodBoy",
                        membership: "join",
                        mxid: "@123:localhost",
                    },
                ],
            };
            const intent = CreateMockIntent(mockRooms);
            const mxid = await Util.GetMxidFromName(intent, "goodboy", ["abc"]);
            expect(mxid).equal("@123:localhost");
        });
        it("Errors on multiple members", async () => {
            const mockRooms = {
                "/rooms/abc/members": [
                    {
                        displayname: "GoodBoy",
                        membership: "join",
                        mxid: "@123:localhost",
                    },
                    {
                        displayname: "GoodBoy",
                        membership: "join",
                        mxid: "@456:localhost",
                    },
                ],
            };
            const intent = CreateMockIntent(mockRooms);
            try {
                await Util.GetMxidFromName(intent, "goodboy", ["abc"]);
                throw new Error("didn't fail");
            } catch (e) {
                expect(e.message).to.not.equal("didn't fail");
            }
        });
        it("Errors on no member", async () => {
            const mockRooms = {
                "/rooms/abc/members": [
                    {
                        displayname: "GoodBoy",
                        membership: "join",
                        mxid: "@123:localhost",
                    },
                ],
            };
            const intent = CreateMockIntent(mockRooms);
            try {
                await Util.GetMxidFromName(intent, "badboy", ["abc"]);
                throw new Error("didn't fail");
            } catch (e) {
                expect(e.message).to.not.equal("didn't fail");
            }
        });
    });
    describe("NumberToHTMLColor", () => {
        it("Should handle valid colors", () => {
            const COLOR = 0xdeadaf;
            const reply = Util.NumberToHTMLColor(COLOR);
            expect(reply).to.equal("#deadaf");
        });
        it("Should reject too large colors", () => {
            const COLOR = 0xFFFFFFFF;
            const reply = Util.NumberToHTMLColor(COLOR);
            expect(reply).to.equal("#ffffff");
        });
        it("Should reject too small colors", () => {
            const COLOR = -1;
            const reply = Util.NumberToHTMLColor(COLOR);
            expect(reply).to.equal("#000000");
        });
    });
    describe("str2mxid", () => {
        it("should leave lowercase stuff untouched", () => {
            const reply = Util.str2mxid("foxies");
            expect(reply).to.equal("foxies");
        });
        it("should handle uppercase stuff", () => {
            const reply = Util.str2mxid("Foxies");
            expect(reply).to.equal("_foxies");
        });
        it("should handle underscores", () => {
            const reply = Util.str2mxid("fox_ies");
            expect(reply).to.equal("fox__ies");
        });
        it("should handle misc. characters", () => {
            const reply = Util.str2mxid("föxies");
            expect(reply).to.equal("f=c3=b6xies");
        });
    });
    describe("mxid2str", () => {
        it("should leave lowercase stuff untouched", () => {
            const reply = Util.mxid2str("foxies");
            expect(reply).to.equal("foxies");
        });
        it("should handle uppercase stuff", () => {
            const reply = Util.mxid2str("_foxies");
            expect(reply).to.equal("Foxies");
        });
        it("should handle underscores", () => {
            const reply = Util.mxid2str("fox__ies");
            expect(reply).to.equal("fox_ies");
        });
        it("should handle misc. characters", () => {
            const reply = Util.mxid2str("f=c3=b6xies");
            expect(reply).to.equal("föxies");
        });
    });
});
