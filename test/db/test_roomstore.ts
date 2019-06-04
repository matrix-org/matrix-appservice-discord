/*
Copyright 2019 matrix-appservice-discord

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import * as Chai from "chai";
// import * as Proxyquire from "proxyquire";
import { DiscordStore, CURRENT_SCHEMA } from "../../src/store";
import { RemoteStoreRoom, MatrixStoreRoom } from "../../src/db/roomstore";

// we are a test file and thus need those
/* tslint:disable: no-any no-unused-expression */

const expect = Chai.expect;

// const assert = Chai.assert;
let store: DiscordStore;
describe("RoomStore", () => {
    before(async () => {
        store = new DiscordStore(":memory:");
        await store.init();
    });
    describe("upsertEntry|getEntriesByMatrixId", () => {
        it("will create a new entry", async () => {
            await store.roomStore.upsertEntry({
                id: "test1",
                matrix: new MatrixStoreRoom("!abc:def.com"),
                remote: new RemoteStoreRoom("123456_789", {discord_guild: "123", discord_channel: "456"}),
            });
            const entry = (await store.roomStore.getEntriesByMatrixId("!abc:def.com"))[0];
            expect(entry.id).to.equal("test1");
            expect(entry.matrix!.roomId).to.equal("!abc:def.com");
            expect(entry.remote!.roomId).to.equal("123456_789");
            expect(entry.remote!.get("discord_guild")).to.equal("123");
            expect(entry.remote!.get("discord_channel")).to.equal("456");
        });
        it("will update an existing entry's rooms", async () => {
            await store.roomStore.upsertEntry({
                id: "test2",
                matrix: new MatrixStoreRoom("test2_m"),
                remote: new RemoteStoreRoom("test2_r", {discord_guild: "123", discord_channel: "456"}),
            });
            await store.roomStore.upsertEntry({
                id: "test2",
                matrix: new MatrixStoreRoom("test2_2m"),
                remote: new RemoteStoreRoom("test2_2r", {discord_guild: "555", discord_channel: "999"}),
            });
            const entry = (await store.roomStore.getEntriesByMatrixId("test2_2m"))[0];
            expect(entry.id).to.equal("test2");
            expect(entry.matrix!.roomId).to.equal("test2_2m");
            expect(entry.remote!.roomId).to.equal("test2_2r");
            expect(entry.remote!.get("discord_guild")).to.equal("555");
            expect(entry.remote!.get("discord_channel")).to.equal("999");
        });
        it("will add new data to an existing entry", async () => {
            await store.roomStore.upsertEntry({
                id: "test3",
                matrix: new MatrixStoreRoom("test3_m"),
                remote: new RemoteStoreRoom("test3_r", {discord_guild: "123", discord_channel: "456"}),
            });
            await store.roomStore.upsertEntry({
                id: "test3",
                matrix: new MatrixStoreRoom("test3_m"),
                remote: new RemoteStoreRoom("test3_r", {discord_guild: "123", discord_channel: "456", update_topic: 1}),
            });
            const entry = (await store.roomStore.getEntriesByMatrixId("test3_m"))[0];
            expect(entry.id).to.equal("test3");
            expect(entry.matrix!.roomId).to.equal("test3_m");
            expect(entry.remote!.roomId).to.equal("test3_r");
            expect(entry.remote!.get("update_topic")).to.equal(1);
        });
        it("will replace data on an existing entry", async () => {
            await store.roomStore.upsertEntry({
                id: "test3.1",
                matrix: new MatrixStoreRoom("test3.1_m"),
                remote: new RemoteStoreRoom("test3.1_r", {discord_guild: "123", discord_channel: "456"}),
            });
            await store.roomStore.upsertEntry({
                id: "test3.1",
                matrix: new MatrixStoreRoom("test3.1_m"),
                remote: new RemoteStoreRoom("test3.1_r", {discord_guild: "-100", discord_channel: "seventythousand"}),
            });
            const entry = (await store.roomStore.getEntriesByMatrixId("test3.1_m"))[0];
            expect(entry.id).to.equal("test3.1");
            expect(entry.matrix!.roomId).to.equal("test3.1_m");
            expect(entry.remote!.roomId).to.equal("test3.1_r");
            expect(entry.remote!.get("discord_guild")).to.equal("-100");
            expect(entry.remote!.get("discord_channel")).to.equal("seventythousand");
        });
        it("will delete data on an existing entry", async () => {
            await store.roomStore.upsertEntry({
                id: "test3.2",
                matrix: new MatrixStoreRoom("test3.2_m"),
                remote: new RemoteStoreRoom("test3.2_r", {
                    discord_channel: "456", discord_guild: "123",  update_icon: true,
                }),
            });
            await store.roomStore.upsertEntry({
                id: "test3.2",
                matrix: new MatrixStoreRoom("test3.2_m"),
                remote: new RemoteStoreRoom("test3.2_r", {discord_guild: "123", discord_channel: "456"}),
            });
            const entry = (await store.roomStore.getEntriesByMatrixId("test3.2_m"))[0];
            expect(entry.id).to.equal("test3.2");
            expect(entry.matrix!.roomId).to.equal("test3.2_m");
            expect(entry.remote!.roomId).to.equal("test3.2_r");
            expect(entry.remote!.get("update_icon")).to.be.eq(0);
        });
    });
    describe("getEntriesByMatrixIds", () => {
        it("will get multiple entries", async () => {
            const EXPECTED_ROOMS = 2;
            await store.roomStore.upsertEntry({
                id: "test4_1",
                matrix: new MatrixStoreRoom("!test_mOne:eggs.com"),
                remote: new RemoteStoreRoom("test4_r", {discord_guild: "five", discord_channel: "five"}),
            });
            await store.roomStore.upsertEntry({
                id: "test4_2",
                matrix: new MatrixStoreRoom("!test_mTwo:eggs.com"),
                remote: new RemoteStoreRoom("test4_r", {discord_guild: "nine", discord_channel: "nine"}),
            });
            const entries = await store.roomStore.getEntriesByMatrixIds(["!test_mOne:eggs.com", "!test_mTwo:eggs.com"]);
            expect(entries).to.have.lengthOf(EXPECTED_ROOMS);
            expect(entries[0].id).to.equal("test4_1");
            expect(entries[0].matrix!.roomId).to.equal("!test_mOne:eggs.com");
            expect(entries[1].id).to.equal("test4_2");
            expect(entries[1].matrix!.roomId).to.equal("!test_mTwo:eggs.com");
        });
    });
    describe("linkRooms", () => {
        it("will link a room", async () => {
            const matrix = new MatrixStoreRoom("test5_m");
            const remote = new RemoteStoreRoom("test5_r", {discord_guild: "five", discord_channel: "five"});
            await store.roomStore.linkRooms(matrix, remote);
            const entries = await store.roomStore.getEntriesByMatrixId("test5_m");
            expect(entries[0].matrix!.roomId).to.equal("test5_m");
            expect(entries[0].remote!.roomId).to.equal("test5_r");
            expect(entries[0].remote!.get("discord_guild")).to.equal("five");
            expect(entries[0].remote!.get("discord_channel")).to.equal("five");
        });
    });
    describe("getEntriesByRemoteRoomData", () => {
        it("will get an entry", async () => {
            await store.roomStore.upsertEntry({
                id: "test6",
                matrix: new MatrixStoreRoom("test6_m"),
                remote: new RemoteStoreRoom("test6_r", {discord_guild: "find", discord_channel: "this"}),
            });
            const entries = await store.roomStore.getEntriesByRemoteRoomData({
                discord_channel: "this",
                discord_guild: "find",
            });
            expect(entries[0].matrix!.roomId).to.equal("test6_m");
            expect(entries[0].remote!.roomId).to.equal("test6_r");
            expect(entries[0].remote!.get("discord_guild")).to.equal("find");
            expect(entries[0].remote!.get("discord_channel")).to.equal("this");
        });
    });
    describe("removeEntriesByRemoteRoomId", () => {
        it("will remove a room", async () => {
            await store.roomStore.upsertEntry({
                id: "test7",
                matrix: new MatrixStoreRoom("test7_m"),
                remote: new RemoteStoreRoom("test7_r", {discord_guild: "find", discord_channel: "this"}),
            });
            await store.roomStore.removeEntriesByRemoteRoomId("test7_r");
            const entries = await store.roomStore.getEntriesByMatrixId("test7_m");
            expect(entries).to.be.empty;
        });
    });
    describe("removeEntriesByMatrixRoomId", () => {
        it("will remove a room", async () => {
            await store.roomStore.upsertEntry({
                id: "test8",
                matrix: new MatrixStoreRoom("test8_m"),
                remote: new RemoteStoreRoom("test8_r", {discord_guild: "find", discord_channel: "this"}),
            });
            await store.roomStore.removeEntriesByRemoteRoomId("test8_m");
            const entries = await store.roomStore.getEntriesByMatrixId("test8_r");
            expect(entries).to.be.empty;
        });
    });
});
describe("RoomStore.schema.v8", () => {
    it("will successfully migrate rooms", async () => {
        const SCHEMA_VERSION = 8;
        store = new DiscordStore(":memory:");
        const roomStore = {
            select: () => {
                return [
                    {
                        _id: "DGFUYs4hlXNDmmw0",
                        id: "123",
                        matrix: {extras: {}},
                        matrix_id: "!badroom:localhost",
                    },
                    {
                        _id: "Dd37MWDw57dAQz5p",
                        data: {},
                        id: "!xdnLTCNErGnwsGnmnm:localhost   discord_282616294245662720_514843269599985674_bridged",
                        matrix: {
                            extras: {},
                        },
                        matrix_id: "!bridged1:localhost",
                        remote: {
                            discord_channel: "514843269599985674",
                            discord_guild: "282616294245662720",
                            discord_type: "text",
                            plumbed: false,
                        },
                        remote_id: "discord_282616294245662720_514843269599985674_bridged",
                    },
                    {
                        _id: "H3XEftQWj8BZYuCe",
                        data: {},
                        id: "!oGkfjmeNEkJdFasVRF:localhost   discord_282616294245662720_520332167952334849",
                        matrix: {
                            extras: {},
                        },
                        matrix_id: "!bridged2:localhost",
                        remote: {
                            discord_channel: "514843269599985674",
                            discord_guild: "282616294245662720",
                            discord_type: "text",
                            plumbed: true,
                            update_icon: true,
                            update_name: false,
                            update_topic: true,
                        },
                        remote_id: "discord_282616294245662720_520332167952334849",
                    },
                ];
            },
        };
        await store.init(SCHEMA_VERSION, roomStore);
        expect(await store.roomStore.getEntriesByMatrixId("!badroom:localhost")).to.be.empty;
        const bridge1 = (await store.roomStore.getEntriesByMatrixId("!bridged1:localhost"))[0];
        expect(bridge1).to.exist;
        expect(bridge1.remote).to.not.be.null;
        expect(bridge1.remote!.data.discord_channel).to.be.equal("514843269599985674");
        expect(bridge1.remote!.data.discord_guild).to.be.equal("282616294245662720");
        expect(bridge1.remote!.data.discord_type).to.be.equal("text");
        expect(!!bridge1.remote!.data.plumbed).to.be.false;
        const bridge2 = (await store.roomStore.getEntriesByMatrixId("!bridged2:localhost"))[0];
        expect(bridge2).to.exist;
        expect(bridge2.remote).to.not.be.null;
        expect(bridge2.remote!.data.discord_channel).to.be.equal("514843269599985674");
        expect(bridge2.remote!.data.discord_guild).to.be.equal("282616294245662720");
        expect(bridge2.remote!.data.discord_type).to.be.equal("text");
        expect(!!bridge2.remote!.data.plumbed).to.be.true;
        expect(!!bridge2.remote!.data.update_icon).to.be.true;
        expect(!!bridge2.remote!.data.update_name).to.be.false;
        expect(!!bridge2.remote!.data.update_topic).to.be.true;
    });
});
