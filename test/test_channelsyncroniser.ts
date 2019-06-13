/*
Copyright 2018, 2019 matrix-appservice-discord

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
import * as Discord from "discord.js";
import * as Proxyquire from "proxyquire";

import { ISingleChannelState, IChannelState, ChannelSyncroniser } from "../src/channelsyncroniser";
import { DiscordBot } from "../src/bot";
import { MockGuild } from "./mocks/guild";
import { MockMember } from "./mocks/member";
import { MatrixEventProcessor, MatrixEventProcessorOpts } from "../src/matrixeventprocessor";
import { DiscordBridgeConfig } from "../src/config";
import { Util } from "../src/util";
import { MockChannel } from "./mocks/channel";
import { Bridge, MatrixRoom, RemoteRoom } from "matrix-appservice-bridge";
// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

const expect = Chai.expect;

let UTIL_UPLOADED_AVATAR: any = null;
let REMOTECHANNEL_SET: any = false;
let REMOTECHANNEL_REMOVED: any = false;
let ROOM_NAME_SET: any = null;
let ROOM_TOPIC_SET: any = null;
let ROOM_AVATAR_SET: any = null;
let STATE_EVENT_SENT: any = false;
let ALIAS_DELETED: any = false;
let ROOM_DIRECTORY_VISIBILITY: any = null;

const ChannelSync = (Proxyquire("../src/channelsyncroniser", {
    "./util": {
        Util: {
            ApplyPatternString: Util.ApplyPatternString,
            UploadContentFromUrl: async () => {
                UTIL_UPLOADED_AVATAR = true;
                return {mxcUrl: "avatarset"};
            },
        },
    },
})).ChannelSyncroniser;

class Entry {
    public id: any;
    public matrix: MatrixRoom;
    public remote: RemoteRoom;
    public data: any;
    constructor(doc: any = {}) {
        this.matrix = doc.matrix_id ? new MatrixRoom(doc.matrix_id, doc.matrix) : undefined;
        this.remote = doc.remote_id ? new RemoteRoom(doc.remote_id, doc.remote) : undefined;
        this.data = doc.data;
    }
}

function CreateChannelSync(remoteChannels: any[] = []): ChannelSyncroniser {
    UTIL_UPLOADED_AVATAR = false;
    const bridge: any = {
        getIntent: (id) => {
            ROOM_NAME_SET = null;
            ROOM_TOPIC_SET = null;
            ROOM_AVATAR_SET = null;
            STATE_EVENT_SENT = false;
            ALIAS_DELETED = false;
            ROOM_DIRECTORY_VISIBILITY = null;
            return {
                getClient: () => {
                    return {
                        deleteAlias: async (alias) => {
                            ALIAS_DELETED = true;
                        },
                        getStateEvent: async (mxid, event) => {
                            if (event === "m.room.canonical_alias") {
                                if (mxid === "!valid:localhost") {
                                    return {
                                        alias: "#alias:localhost",
                                    };
                                } else {
                                    return null;
                                }
                            }
                            return event;
                        },
                        sendStateEvent: async (mxid, event, data) => {
                            STATE_EVENT_SENT = true;
                        },
                        setRoomDirectoryVisibility: async (mxid, visibility) => {
                            ROOM_DIRECTORY_VISIBILITY = visibility;
                        },
                        setRoomName: async (mxid, name) => {
                            ROOM_NAME_SET = name;
                        },
                        setRoomTopic: async (mxid, topic) => {
                            ROOM_TOPIC_SET = topic;
                        },
                    };
                },
                setRoomAvatar: async (mxid, mxc) => {
                    ROOM_AVATAR_SET = mxc;
                },
                setRoomName: async (mxid, name) => {
                    ROOM_NAME_SET = name;
                },
                setRoomTopic: async (mxid, topic) => {
                    ROOM_TOPIC_SET = topic;
                },
            };
        },
    };
    REMOTECHANNEL_REMOVED = false;
    REMOTECHANNEL_SET = false;
    const roomStore = {
        getEntriesByMatrixId: (roomid) => {
            const entries: any[] = [];
            remoteChannels.forEach((c) => {
                const mxid = c.matrix.getId();
                if (roomid === mxid) {
                    entries.push(c);
                }
            });
            return entries;
        },
        getEntriesByMatrixIds: (roomids) => {
            const entries = {};
            remoteChannels.forEach((c) => {
                const mxid = c.matrix.getId();
                if (roomids.includes(mxid)) {
                    if (!entries[mxid]) {
                        entries[mxid] = [];
                    }
                    entries[mxid].push(c);
                }
            });
            return entries;
        },
        getEntriesByRemoteRoomData: (data) => {
            return remoteChannels.filter((c) => {
                for (const d of Object.keys(data)) {
                    if (c.remote.get(d) !== data[d]) {
                        return false;
                    }
                }
                return true;
            });
        },
        removeEntriesByMatrixRoomId: (room) => {
            REMOTECHANNEL_REMOVED = true;
        },
        upsertEntry: (room) => {
            REMOTECHANNEL_SET = true;
        },
    };
    const discordbot: any = {

    };
    const config = new DiscordBridgeConfig();
    config.bridge.domain = "localhost";
    config.channel.namePattern = "[Discord] :guild :name";
    const cs = new ChannelSync(bridge as Bridge, config, discordbot, roomStore) as ChannelSyncroniser;
    return cs;
}

describe("ChannelSyncroniser", () => {
    describe("HandleChannelDelete", () => {
        it("will not delete non-text channels", async () => {
            const chan = new MockChannel();
            chan.id = "blah";
            chan.type = "voice";
            const testStore = [
                new Entry({
                    id: "1",
                    matrix_id: "!1:localhost",
                    remote: {
                        discord_channel: chan.id,
                    },
                    remote_id: "111",
                }),
            ];

            const channelSync = CreateChannelSync(testStore);
            await channelSync.OnDelete(chan as any);

            expect(REMOTECHANNEL_REMOVED).is.false;
        });
        it("will delete text channels", async () => {
            const chan = new MockChannel();
            chan.id = "blah";
            chan.type = "text";
            const testStore = [
                new Entry({
                    id: "1",
                    matrix_id: "!1:localhost",
                    remote: {
                        discord_channel: chan.id,
                    },
                    remote_id: "111",
                }),
            ];

            const channelSync = CreateChannelSync(testStore);
            await channelSync.OnDelete(chan as any);

            expect(REMOTECHANNEL_REMOVED).is.true;
        });
    });
    describe("GetRoomIdsFromChannel", () => {
        it("should get one room ID", async () => {
            const chan = new MockChannel();
            chan.id = "blah";
            const testStore = [
                new Entry({
                    id: "1",
                    matrix_id: "!1:localhost",
                    remote: {
                        discord_channel: chan.id,
                    },
                    remote_id: "111",
                }),
            ];

            const channelSync = CreateChannelSync(testStore);
            const chans = await channelSync.GetRoomIdsFromChannel(chan as any);

            expect(chans.length).equals(1);
            expect(chans[0]).equals("!1:localhost");
        });
        it("should get multiple room IDs", async () => {
            const chan = new MockChannel();
            chan.id = "blah";
            const testStore = [
                new Entry({
                    id: "1",
                    matrix_id: "!1:localhost",
                    remote: {
                        discord_channel: chan.id,
                    },
                    remote_id: "111",
                }),
                new Entry({
                    id: "2",
                    matrix_id: "!2:localhost",
                    remote: {
                        discord_channel: chan.id,
                    },
                    remote_id: "111",
                }),
                new Entry({
                    id: "3",
                    matrix_id: "!3:localhost",
                    remote: {
                        discord_channel: "no",
                    },
                    remote_id: "false",
                }),
            ];

            const channelSync = CreateChannelSync(testStore);
            const chans = await channelSync.GetRoomIdsFromChannel(chan as any);
            /* tslint:disable:no-magic-numbers */
            expect(chans.length).equals(2);
            /* tslint:enable:no-magic-numbers */
            expect(chans[0]).equals("!1:localhost");
            expect(chans[1]).equals("!2:localhost");
        });
        it("should reject on no rooms", async () => {
            const chan = new MockChannel();
            chan.id = "blah";
            const channelSync = CreateChannelSync();
            try {
                await channelSync.GetRoomIdsFromChannel(chan as any);
                throw new Error("didn't fail");
            } catch (e) {
                expect(e.message).to.not.equal("didn't fail");
            }
        });
    });
    describe("GetAliasFromChannel", () => {
        const getIds = async (chan) => {
            if (chan.id === "678") {
                return ["!valid:localhost"];
            }
            throw new Error("invalid");
        };
        it("Should get one canonical alias for a room", async () => {
            const chan = new MockChannel();
            chan.id = "678";
            const channelSync = CreateChannelSync();
            channelSync.GetRoomIdsFromChannel = getIds;
            const alias = await channelSync.GetAliasFromChannel(chan as any);

            expect(alias).to.equal("#alias:localhost");
        });
        it("Should return null if no alias found and no guild present", async () => {
            const chan = new MockChannel();
            chan.id = "123";
            const channelSync = CreateChannelSync();
            channelSync.GetRoomIdsFromChannel = getIds;
            const alias = await channelSync.GetAliasFromChannel(chan as any);

            expect(alias).to.equal(null);
        });
        it("Should return a #_discord_ alias if a guild is present", async () => {
            const chan = new MockChannel();
            const guild = new MockGuild("123");
            chan.id = "123";
            chan.guild = guild;
            const channelSync = CreateChannelSync();
            channelSync.GetRoomIdsFromChannel = getIds;
            const alias = await channelSync.GetAliasFromChannel(chan as any);

            expect(alias).to.equal("#_discord_123_123:localhost");
        });
    });
    describe("GetChannelUpdateState", () => {
        it("will do nothing on no rooms", async () => {
            const chan = new MockChannel();
            chan.type = "text";
            chan.id = "blah";

            const channelSync = CreateChannelSync();
            const state = await channelSync.GetChannelUpdateState(chan as any);
            expect(state.id).equals(chan.id);
            expect(state.mxChannels.length).equals(0);
        });
        it("will update name and topic", async () => {
            const guild = new MockGuild("654321", [], "newGuild");
            const chan = new MockChannel();
            chan.type = "text";
            chan.id = "blah";
            chan.name = "newName";
            chan.topic = "newTopic";
            chan.guild = guild;

            const testStore = [
                new Entry({
                    id: "1",
                    matrix_id: "!1:localhost",
                    remote: {
                        discord_channel: chan.id,
                        discord_name: "[Discord] oldGuild oldName",
                        discord_topic: "oldTopic",
                        update_name: true,
                        update_topic: true,
                    },
                    remote_id: "111",
                }),
            ];

            const channelSync = CreateChannelSync(testStore);
            const state = await channelSync.GetChannelUpdateState(chan as any);
            expect(state.mxChannels.length).equals(1);
            expect(state.mxChannels[0].name).equals("[Discord] newGuild #newName");
            expect(state.mxChannels[0].topic).equals("newTopic");
        });
        it("won't update name and topic if props not set", async () => {
            const guild = new MockGuild("654321", [], "newGuild");
            const chan = new MockChannel();
            chan.type = "text";
            chan.id = "blah";
            chan.name = "newName";
            chan.topic = "newTopic";
            chan.guild = guild;

            const testStore = [
                new Entry({
                    id: "1",
                    matrix_id: "!1:localhost",
                    remote: {
                        discord_channel: chan.id,
                        discord_name: "[Discord] oldGuild oldName",
                        discord_topic: "oldTopic",
                    },
                    remote_id: "111",
                }),
            ];

            const channelSync = CreateChannelSync(testStore);
            const state = await channelSync.GetChannelUpdateState(chan as any);
            expect(state.mxChannels.length).equals(1);
            expect(state.mxChannels[0].name).is.null;
            expect(state.mxChannels[0].topic).is.null;
        });
        it("won't update name and topic if not changed", async () => {
            const guild = new MockGuild("654321", [], "newGuild");
            const chan = new MockChannel();
            chan.type = "text";
            chan.id = "blah";
            chan.name = "newName";
            chan.topic = "newTopic";
            chan.guild = guild;

            const testStore = [
                new Entry({
                    id: "1",
                    matrix_id: "!1:localhost",
                    remote: {
                        discord_channel: chan.id,
                        discord_name: "[Discord] newGuild #newName",
                        discord_topic: "newTopic",
                        update_name: true,
                        update_topic: true,
                    },
                    remote_id: "111",
                }),
            ];

            const channelSync = CreateChannelSync(testStore);
            const state = await channelSync.GetChannelUpdateState(chan as any);
            expect(state.mxChannels.length).equals(1);
            expect(state.mxChannels[0].name).is.null;
            expect(state.mxChannels[0].topic).is.null;
        });
        it("will update the icon", async () => {
            const guild = new MockGuild("654321", [], "newGuild");
            guild.icon = "new_icon";
            const chan = new MockChannel();
            chan.type = "text";
            chan.id = "blah";
            chan.guild = guild;

            const testStore = [
                new Entry({
                    id: "1",
                    matrix_id: "!1:localhost",
                    remote: {
                        discord_channel: chan.id,
                        discord_iconurl: "https://cdn.discordapp.com/icons/654321/old_icon.png",
                        update_icon: true,
                    },
                    remote_id: "111",
                }),
            ];

            const channelSync = CreateChannelSync(testStore);
            const state = await channelSync.GetChannelUpdateState(chan as any);
            expect(state.mxChannels.length).equals(1);
            expect(state.mxChannels[0].iconUrl).equals("https://cdn.discordapp.com/icons/654321/new_icon.png");
            expect(state.mxChannels[0].iconId).equals("new_icon");
        });
        it("will update animated icons", async () => {
            const guild = new MockGuild("654321", [], "newGuild");
            guild.icon = "a_new_icon";
            const chan = new MockChannel();
            chan.type = "text";
            chan.id = "blah";
            chan.guild = guild;

            const testStore = [
                new Entry({
                    id: "1",
                    matrix_id: "!1:localhost",
                    remote: {
                        discord_channel: chan.id,
                        discord_iconurl: "https://cdn.discordapp.com/icons/654321/old_icon.png",
                        update_icon: true,
                    },
                    remote_id: "111",
                }),
            ];

            const channelSync = CreateChannelSync(testStore);
            const state = await channelSync.GetChannelUpdateState(chan as any);
            expect(state.mxChannels.length).equals(1);
            expect(state.mxChannels[0].iconUrl).equals("https://cdn.discordapp.com/icons/654321/a_new_icon.gif");
            expect(state.mxChannels[0].iconId).equals("a_new_icon");
        });
        it("won't update the icon", async () => {
            const guild = new MockGuild("654321", [], "newGuild");
            guild.icon = "new_icon";
            const chan = new MockChannel();
            chan.type = "text";
            chan.id = "blah";
            chan.guild = guild;

            const testStore = [
                new Entry({
                    id: "1",
                    matrix_id: "!1:localhost",
                    remote: {
                        discord_channel: chan.id,
                        discord_iconurl: "https://cdn.discordapp.com/icons/654321/new_icon.png",
                        update_icon: true,
                    },
                    remote_id: "111",
                }),
            ];

            const channelSync = CreateChannelSync(testStore);
            const state = await channelSync.GetChannelUpdateState(chan as any);
            expect(state.mxChannels.length).equals(1);
            expect(state.mxChannels[0].iconUrl).is.null;
            expect(state.mxChannels[0].iconId).is.null;
        });
        it("will delete the icon", async () => {
            const guild = new MockGuild("654321", [], "newGuild");
            guild.icon = "";
            const chan = new MockChannel();
            chan.type = "text";
            chan.id = "blah";
            chan.guild = guild;

            const testStore = [
                new Entry({
                    id: "1",
                    matrix_id: "!1:localhost",
                    remote: {
                        discord_channel: chan.id,
                        discord_iconurl: "https://cdn.discordapp.com/icons/654321/icon.png",
                        update_icon: true,
                    },
                    remote_id: "111",
                }),
            ];

            const channelSync = CreateChannelSync(testStore);
            const state = await channelSync.GetChannelUpdateState(chan as any);
            expect(state.mxChannels.length).equals(1);
            expect(state.mxChannels[0].removeIcon).is.true;
        });
    });
    describe("OnUpdate", () => {
        it("Will update a room", async () => {
            const guild = new MockGuild("654321", [], "newGuild");
            guild.icon = "new_icon";
            const chan = new MockChannel();
            chan.type = "text";
            chan.id = "blah";
            chan.name = "newName";
            chan.topic = "newTopic";
            chan.guild = guild;

            const testStore = [
                new Entry({
                    id: "1",
                    matrix_id: "!1:localhost",
                    remote: {
                        discord_channel: chan.id,
                        discord_iconurl: "https://cdn.discordapp.com/icons/654321/old_icon.png",
                        discord_name: "[Discord] oldGuild #oldName",
                        discord_topic: "oldTopic",
                        update_icon: true,
                        update_name: true,
                        update_topic: true,
                    },
                    remote_id: "111",
                }),
            ];

            const channelSync = CreateChannelSync(testStore);
            const state = await channelSync.OnUpdate(chan as any);
            expect(ROOM_NAME_SET).equals("[Discord] newGuild #newName");
            expect(ROOM_TOPIC_SET).equals("newTopic");
            expect(ROOM_AVATAR_SET).equals("avatarset");
            expect(REMOTECHANNEL_SET).is.true;
            expect(UTIL_UPLOADED_AVATAR).is.true;
        });
    });
});
