import * as Chai from "chai";
import { Provisioner } from "../src/provisioner";
import { MockChannel } from "./mocks/channel";
import { MockMember } from "./mocks/member";

// we are a test file and thus need those
/* tslint:disable:no-any */

const expect = Chai.expect;

const TIMEOUT_MS = 1000;

describe("Provisioner", () => {
    describe("AskBridgePermission", () => {
        it("should fail to bridge a room that timed out", async () => {
            const p = new Provisioner();
            const startAt = Date.now();
            try {
                await p.AskBridgePermission(
                    new MockChannel("foo", "bar") as any,
                    "Mark",
                    TIMEOUT_MS,
                );
                throw Error("Should have thrown an error");
            } catch (err) {
                expect(err.message).to.eq("Timed out waiting for a response from the Discord owners");
                const delay = Date.now() - startAt;
                if (delay < TIMEOUT_MS) {
                    throw Error(`Should have waited for timeout before resolving, waited: ${delay}ms`);
                }
            }
        });
        it("should fail to bridge a room that was declined", async () => {
            const p = new Provisioner();
            const promise = p.AskBridgePermission(
                new MockChannel("foo", "bar") as any,
                "Mark",
                TIMEOUT_MS,
            );
            await p.MarkApproved(new MockChannel("foo", "bar") as any, new MockMember("abc", "Mark") as any, false);
            try {
                await promise;
                throw Error("Should have thrown an error");
            } catch (err) {
                expect(err.message).to.eq("The bridge has been declined by the Discord guild");
            }

        });
        it("should bridge a room that was approved", async () => {
            const p = new Provisioner();
            const promise = p.AskBridgePermission(
                new MockChannel("foo", "bar") as any,
                "Mark",
                TIMEOUT_MS,
            );
            await p.MarkApproved(new MockChannel("foo", "bar") as any, new MockMember("abc", "Mark") as any, true);
            expect(await promise).to.eq("Approved");
        });
    });
});
