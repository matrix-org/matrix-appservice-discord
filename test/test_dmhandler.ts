import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import * as Discord from "discord.js";
import * as Proxyquire from "proxyquire";

// import * as Proxyquire from "proxyquire";
import { DMHandler } from "../src/dmhandler";
import { DiscordBot } from "../src/bot";
import { MockGuild } from "./mocks/guild";
import { MockMember } from "./mocks/member";

Chai.use(ChaiAsPromised);
const expect = Chai.expect;
const INTERVAL = 250;
const lastStatus = null;
// const assert = Chai.assert;
const bot = {

};
/*
describe("DMHandler", () => {
    describe("OnInvite", () => {
        it("should join a room for a 1:1 with a Matrix user", () => {
            throw Error("Not implemented");
        });
        it("should accept an invite for a group DM", () => {
            throw Error("Not implemented");
        });
        it("should leave old room on invite to a new DM", () => {
            throw Error("Not implemented");
        });
        it("should warn if a non-puppeted user is added to a DM", () => {
            throw Error("Not implemented");
        });
        it("should leave if the size of the group is too large", () => {
            throw Error("Not implemented");
        });
    });
    describe("OnInvite", () => {
        it("should create a room for a 1:1 with a Matrix user", () => {
            throw Error("Not implemented");
        });
        it("should invite a user for a group DM", () => {
            throw Error("Not implemented");
        });
    });
});
*/
