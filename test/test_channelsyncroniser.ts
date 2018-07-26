import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import * as log from "npmlog";
import * as Discord from "discord.js";
import * as Proxyquire from "proxyquire";

import { ISingleChannelState, IChannelState, ChannelSyncroniser } from "../src/channelsyncroniser";
import { DiscordBot } from "../src/bot";
import { MockGuild } from "./mocks/guild";
import { MockMember } from "./mocks/member";
import { MatrixEventProcessor, MatrixEventProcessorOpts } from "../src/matrixeventprocessor";
import { DiscordBridgeConfig } from "../src/config";
import { MessageProcessor, MessageProcessorOpts } from "../src/messageprocessor";
import { MockChannel } from "./mocks/channel";
import { Bridge, MatrixRoom, RemoteRoom } from "matrix-appservice-bridge";

Chai.use(ChaiAsPromised);
const expect = Chai.expect;

let UTIL_UPLOADED_AVATAR = null;
let REMOTECHANNEL_SET = false;
let REMOTECHANNEL_REMOVED = false;
let ROOM_NAME_SET = null;
let ROOM_TOPIC_SET = null;
let ROOM_AVATAR_SET = null;
let STATE_EVENT_SENT = false;
let ALIAS_DELETED = false;
let ROOM_DIRECTORY_VISIBILITY = null;

const ChannelSync = (Proxyquire("../src/channelsyncroniser", {
    "./util": {
        Util: {
            UploadContentFromUrl: () => {
                UTIL_UPLOADED_AVATAR = true;
                return Promise.resolve({mxcUrl: "avatarset"});
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
        getRoomStore: () => {
            REMOTECHANNEL_SET = false;
            REMOTECHANNEL_REMOVED = false;
            return {
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
                getEntriesByMatrixId: (roomid) => {
                    const entries = [];
                    remoteChannels.forEach((c) => {
                        const mxid = c.matrix.getId();
                        if (roomid === mxid) {
                            entries.push(c);
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
                upsertEntry: (room) => {
                    REMOTECHANNEL_SET = true;
                },
                removeEntriesByMatrixRoomId: (room) => {
                    REMOTECHANNEL_REMOVED = true;
                },
            };
        },
        getIntent: (id) => {
            ROOM_NAME_SET = null;
            ROOM_TOPIC_SET = null;
            ROOM_AVATAR_SET = null;
            STATE_EVENT_SENT = false;
            ALIAS_DELETED = false;
            ROOM_DIRECTORY_VISIBILITY = null;
            return {
                setRoomName: (mxid, name) => {
                    ROOM_NAME_SET = name;
                    return Promise.resolve();
                },
                setRoomTopic: (mxid, topic) => {
                    ROOM_TOPIC_SET = topic;
                    return Promise.resolve();
                },
                setRoomAvatar: (mxid, mxc) => {
                    ROOM_AVATAR_SET = mxc;
                    return Promise.resolve();
                },
                getClient: () => {
                    return {
                        getStateEvent: (mxid, event) => {
                            return Promise.resolve(event);
                        },
                        setRoomName: (mxid, name) => {
                            ROOM_NAME_SET = name;
                            return Promise.resolve();
                        },
                        setRoomTopic: (mxid, topic) => {
                            ROOM_TOPIC_SET = topic;
                            return Promise.resolve();
                        },
                        sendStateEvent: (mxid, event, data) => {
                            STATE_EVENT_SENT = true;
                            return Promise.resolve();
                        },
                        deleteAlias: (alias) => {
                            ALIAS_DELETED = true;
                            return Promise.resolve();
                        },
                        setRoomDirectoryVisibility: (mxid, visibility) => {
                            ROOM_DIRECTORY_VISIBILITY = visibility;
                            return Promise.resolve();
                        },
                    };
                },
            };
        },
    };
    const discordbot: any = {
        
    };
    const config = new DiscordBridgeConfig();
    config.bridge.domain = "localhost";
    config.channel.namePattern = "[Discord] :guild :name";
    return new ChannelSync(bridge as Bridge, config, discordbot);
}

function GetTestData() {
    return [
        new Entry({
            id: "1",
            matrix_id: "!1:localhost",
            remote_id: "111",
            remote: {
                
            },
        }),
        new Entry({
            id: "2",
            matrix_id: "!2:localhost",
            remote_id: "222",
            remote: {
                
            },
        }),
        new Entry({
            id: "3",
            matrix_id: "!3:localhost",
            remote_id: "333",
            remote: {
                
            },
        }),
    ];
}

describe("ChannelSyncroniser", () => {
    describe("HandleChannelDelete", () => {
        it("will not delete non-text channels", () => {
            const chan = new MockChannel();
            chan.id = "blah";
            chan.type = "voice";
            const testStore = [
                new Entry({
                    id: "1",
                    matrix_id: "!1:localhost",
                    remote_id: "111",
                    remote: {
                        discord_channel: chan.id,
                    },
                }),
            ];
            
            const channelSync = CreateChannelSync(testStore);
            return channelSync.OnDelete(<any> chan).then(() => {
                expect(REMOTECHANNEL_REMOVED).is.false;
            });
        });
        it("will delete non-text channels", () => {
            const chan = new MockChannel();
            chan.id = "blah";
            chan.type = "text";
            const testStore = [
                new Entry({
                    id: "1",
                    matrix_id: "!1:localhost",
                    remote_id: "111",
                    remote: {
                        discord_channel: chan.id,
                    },
                }),
            ];
            
            const channelSync = CreateChannelSync(testStore);
            return channelSync.OnDelete(<any> chan).then(() => {
                expect(REMOTECHANNEL_REMOVED).is.true;
            });
        });
    });
    describe("GetRoomIdsFromChannel", () => {
        it("should get one room ID", () => {
            const chan = new MockChannel();
            chan.id = "blah";
            const testStore = [
                new Entry({
                    id: "1",
                    matrix_id: "!1:localhost",
                    remote_id: "111",
                    remote: {
                        discord_channel: chan.id,
                    },
                }),
            ];
            
            const channelSync = CreateChannelSync(testStore);
            return channelSync.GetRoomIdsFromChannel(<any> chan).then((chans) => {
                expect(chans.length).equals(1);
                expect(chans[0]).equals("!1:localhost");
            });
        });
        it("should get multiple room IDs", () => {
            const chan = new MockChannel();
            chan.id = "blah";
            const testStore = [
                new Entry({
                    id: "1",
                    matrix_id: "!1:localhost",
                    remote_id: "111",
                    remote: {
                        discord_channel: chan.id,
                    },
                }),
                new Entry({
                    id: "2",
                    matrix_id: "!2:localhost",
                    remote_id: "111",
                    remote: {
                        discord_channel: chan.id,
                    },
                }),
                new Entry({
                    id: "3",
                    matrix_id: "!3:localhost",
                    remote_id: "false",
                    remote: {
                        discord_channel: "no",
                    },
                }),
            ];
            
            const channelSync = CreateChannelSync(testStore);
            return channelSync.GetRoomIdsFromChannel(<any> chan).then((chans) => {
                /* tslint:disable:no-magic-numbers */
                expect(chans.length).equals(2);
                /* tslint:enable:no-magic-numbers */
                expect(chans[0]).equals("!1:localhost");
                expect(chans[1]).equals("!2:localhost");
            });
        });
        it("should reject on no rooms", () => {
            const chan = new MockChannel();
            chan.id = "blah";
            const channelSync = CreateChannelSync();
            expect(channelSync.GetRoomIdsFromChannel(<any> chan)).to.eventually.be.rejected;
        });
    });
    describe("GetChannelUpdateState", () => {
        it("will do nothing on no rooms", () => {
            const chan = new MockChannel();
            chan.type = "text";
            chan.id = "blah";
            
            const channelSync = CreateChannelSync();
            return channelSync.GetChannelUpdateState(<any> chan).then((state) => {
                expect(state.id).equals(chan.id);
                expect(state.mxChannels.length).equals(0);
            });
        });
        it("will update name and topic", () => {
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
                    remote_id: "111",
                    remote: {
                        discord_channel: chan.id,
                        discord_name: "[Discord] oldGuild oldName",
                        discord_topic: "oldTopic",
                        update_name: true,
                        update_topic: true,
                    },
                }),
            ];
            
            const channelSync = CreateChannelSync(testStore);
            return channelSync.GetChannelUpdateState(<any> chan).then((state) => {
                expect(state.mxChannels.length).equals(1);
                expect(state.mxChannels[0].name).equals("[Discord] newGuild #newName");
                expect(state.mxChannels[0].topic).equals("newTopic");
            });
        });
        it("won't update name and topic if props not set", () => {
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
                    remote_id: "111",
                    remote: {
                        discord_channel: chan.id,
                        discord_name: "[Discord] oldGuild oldName",
                        discord_topic: "oldTopic",
                    },
                }),
            ];
            
            const channelSync = CreateChannelSync(testStore);
            return channelSync.GetChannelUpdateState(<any> chan).then((state) => {
                expect(state.mxChannels.length).equals(1);
                expect(state.mxChannels[0].name).is.null;
                expect(state.mxChannels[0].topic).is.null;
            });
        });
        it("won't update name and topic if not changed", () => {
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
                    remote_id: "111",
                    remote: {
                        discord_channel: chan.id,
                        discord_name: "[Discord] newGuild #newName",
                        discord_topic: "newTopic",
                        update_name: true,
                        update_topic: true,
                    },
                }),
            ];
            
            const channelSync = CreateChannelSync(testStore);
            return channelSync.GetChannelUpdateState(<any> chan).then((state) => {
                expect(state.mxChannels.length).equals(1);
                expect(state.mxChannels[0].name).is.null;
                expect(state.mxChannels[0].topic).is.null;
            });
        });
        it("will update the icon", () => {
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
                    remote_id: "111",
                    remote: {
                        discord_channel: chan.id,
                        discord_iconurl: "https://cdn.discordapp.com/icons/654321/old_icon.png",
                        update_icon: true,
                    },
                }),
            ];
            
            const channelSync = CreateChannelSync(testStore);
            return channelSync.GetChannelUpdateState(<any> chan).then((state) => {
                expect(state.mxChannels.length).equals(1);
                expect(state.mxChannels[0].iconUrl).equals("https://cdn.discordapp.com/icons/654321/new_icon.png");
                expect(state.mxChannels[0].iconId).equals("new_icon");
            });
        });
        it("won't update the icon", () => {
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
                    remote_id: "111",
                    remote: {
                        discord_channel: chan.id,
                        discord_iconurl: "https://cdn.discordapp.com/icons/654321/new_icon.png",
                        update_icon: true,
                    },
                }),
            ];
            
            const channelSync = CreateChannelSync(testStore);
            return channelSync.GetChannelUpdateState(<any> chan).then((state) => {
                expect(state.mxChannels.length).equals(1);
                expect(state.mxChannels[0].iconUrl).is.null;
                expect(state.mxChannels[0].iconId).is.null;
            });
        });
        it("will delete the icon", () => {
            const guild = new MockGuild("654321", [], "newGuild");
            guild.icon = null;
            const chan = new MockChannel();
            chan.type = "text";
            chan.id = "blah";
            chan.guild = guild;
            
            const testStore = [
                new Entry({
                    id: "1",
                    matrix_id: "!1:localhost",
                    remote_id: "111",
                    remote: {
                        discord_channel: chan.id,
                        discord_iconurl: "https://cdn.discordapp.com/icons/654321/icon.png",
                        update_icon: true,
                    },
                }),
            ];
            
            const channelSync = CreateChannelSync(testStore);
            return channelSync.GetChannelUpdateState(<any> chan).then((state) => {
                expect(state.mxChannels.length).equals(1);
                expect(state.mxChannels[0].removeIcon).is.true;
            });
        });
    });
    describe("OnUpdate", () => {
        it("Will update a room", () => {
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
                    remote_id: "111",
                    remote: {
                        discord_channel: chan.id,
                        discord_name: "[Discord] oldGuild #oldName",
                        discord_topic: "oldTopic",
                        discord_iconurl: "https://cdn.discordapp.com/icons/654321/old_icon.png",
                        update_name: true,
                        update_topic: true,
                        update_icon: true,
                    },
                }),
            ];
            
            const channelSync = CreateChannelSync(testStore);
            return channelSync.OnUpdate(<any> chan).then((state) => {
                expect(ROOM_NAME_SET).equals("[Discord] newGuild #newName");
                expect(ROOM_TOPIC_SET).equals("newTopic");
                expect(ROOM_AVATAR_SET).equals("avatarset");
                expect(REMOTECHANNEL_SET).is.true;
                expect(UTIL_UPLOADED_AVATAR).is.true;
            });
        });
    });
});
