import * as Chai from "chai";
import * as Discord from "discord.js";
import * as Proxyquire from "proxyquire";

import { Provisioner } from "../src/provisioner";
import { MockChannel } from "./mocks/channel";
import { MockMember } from "./mocks/member";

// we are a test file and thus need those
/* tslint:disable:no-any */

const expect = Chai.expect;
const INTERVAL = 250;
let lastStatus = null;
// const assert = Chai.assert;
const bot = {
    GetBotId: () => {
        return "1234";
    },
    GetIntentFromDiscordMember: (member) => {
        return {
            getClient: () => {
                return {
                    setPresence: async (status) => {
                        lastStatus = status;
                    },
                };
            },
        };
    },
};

const TIMEOUT_MS = 1000;

describe("Provisioner", () => {
    describe("AskBridgePermission", () => {
        it("should fail to bridge a room that timed out", async () => {
            const p = new Provisioner();
            const startAt = Date.now();
            await p.AskBridgePermission(
                new MockChannel("foo", "bar") as any,
                "Mark",
                TIMEOUT_MS,
            ).then(() => {
                throw Error("Should have thrown an error");
            }).catch((err) => {
                expect(err.message).to.eq("Timed out waiting for a response from the Discord owners");
                const delay = Date.now() - startAt;
                if (delay < TIMEOUT_MS) {
                    throw Error(`Should have waited for timeout before resolving, waited: ${delay}ms`);
                }
            });
        });
        it("should fail to bridge a room that was declined", async () => {
            const p = new Provisioner();
            const promise = p.AskBridgePermission(
                new MockChannel("foo", "bar") as any,
                "Mark",
                TIMEOUT_MS,
            ).then(() => {
                throw Error("Should have thrown an error");
            }).catch((err) => {
                expect(err.message).to.eq("The bridge has been declined by the Discord guild");
            });
            await p.MarkApproved(new MockChannel("foo", "bar") as any, new MockMember("abc", "Mark") as any, false);
            await promise;
        });
        it("should bridge a room that was approved", async () => {
            const p = new Provisioner();
            const promise = p.AskBridgePermission(
                new MockChannel("foo", "bar") as any,
                "Mark",
                TIMEOUT_MS,
            ).then((msg) => {
                expect(msg).to.eq("Approved");
            });
            await p.MarkApproved(new MockChannel("foo", "bar") as any, new MockMember("abc", "Mark") as any, true);
            await promise;
        });
    });
});
