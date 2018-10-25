import * as Discord from "discord.js";
import { DiscordBot } from "./bot";
import { Util } from "./util";
import { DiscordBridgeConfig } from "./config";
import { Bridge, RoomBridgeStore } from "matrix-appservice-bridge";
import { Log } from "./log";

const log = new Log("ChannelSync");

const POWER_LEVEL_MESSAGE_TALK = 50;

const DEFAULT_CHANNEL_STATE = {
    id: null,
    mxChannels: [],
    iconMxcUrl: null,
};

const DEFAULT_SINGLECHANNEL_STATE = {
    mxid: null,
    name: null, // nullable
    topic: null, // nullable
    iconUrl: null, // nullable
    iconId: null,
    removeIcon: false,
};

export interface ISingleChannelState {
    mxid: string;
    name: string; // nullable
    topic: string; // nullable
    iconUrl: string; // nullable
    iconId: string; // nullable
    removeIcon: boolean;
};

export interface IChannelState {
    id: string;
    mxChannels: ISingleChannelState[];
    iconMxcUrl: string; // nullable
};

export class ChannelSyncroniser {

    private roomStore: RoomBridgeStore;
    constructor(
        private bridge: Bridge,
        private config: DiscordBridgeConfig,
        private bot: DiscordBot) {
        this.roomStore = this.bridge.getRoomStore();
    }

    public async OnUpdate(channel: Discord.Channel) {
        if (channel.type !== "text") {
            return; // Not supported for now
        }
        const channelState = await this.GetChannelUpdateState(channel as Discord.TextChannel);
        try {
            await this.ApplyStateToChannel(channelState);
        } catch (e) {
            log.error("Failed to update channels", e);
        }
    }

    public async OnGuildUpdate(guild: Discord.Guild) {
        log.verbose(`Got guild update for guild ${guild.id}`);
        const channelStates = [];
        for (const [_, channel] of guild.channels) {
            if (channel.type !== "text") {
                continue; // not supported for now
            }
            try {
                const channelState = await this.GetChannelUpdateState(channel as Discord.TextChannel);
                channelStates.push(channelState);
            } catch (e) {
                log.error("Failed to get channel state", e);
            }
        }
        
        let iconMxcUrl = null;
        for (const channelState of channelStates) {
            channelState.iconMxcUrl = channelState.iconMxcUrl || iconMxcUrl;
            try {
                await this.ApplyStateToChannel(channelState);
            } catch (e) {
                log.error("Failed to update channels", e);
            }
            iconMxcUrl = channelState.iconMxcUrl;
        }
    }

    public async OnDelete(channel: Discord.Channel) {
        if (channel.type !== "text") {
            log.info(`Channel ${channel.id} was deleted but isn't a text channel, so ignoring.`);
            return;
        }
        log.info(`Channel ${channel.id} has been deleted.`);
        let roomids;
        let entries;
        try {
            roomids = await this.GetRoomIdsFromChannel(channel);
            entries = await this.roomStore.getEntriesByMatrixIds(roomids);
        } catch (e) {
            log.warn(`Couldn't find roomids for deleted channel ${channel.id}`);
            return;
        }
        for (const roomid of roomids){
            try {
                await this.handleChannelDeletionForRoom(channel as Discord.TextChannel, roomid, entries[roomid][0]);
            } catch (e) {
                log.error(`Failed to delete channel from room: ${e}`);
            }
        }
    }

    public async OnGuildDelete(guild: Discord.Guild) {
        for (const [_, channel] of guild.channels) {
            try {
                await this.OnDelete(channel);
            } catch (e) {
                log.error(`Failed to delete guild channel`);
            }
        }
    }

    public async GetRoomIdsFromChannel(channel: Discord.Channel): Promise<string[]> {
        const rooms = await this.roomStore.getEntriesByRemoteRoomData({
            discord_channel: channel.id,
        });
        if (rooms.length === 0) {
            log.verbose(`Couldn't find room(s) for channel ${channel.id}.`);
            return Promise.reject("Room(s) not found.");
        }
        return rooms.map((room) => room.matrix.getId() as string);
    }

    public async GetChannelUpdateState(channel: Discord.TextChannel, forceUpdate = false): Promise<IChannelState> {
        log.verbose(`State update request for ${channel.id}`);
        const channelState = Object.assign({}, DEFAULT_CHANNEL_STATE, {
            id: channel.id,
            mxChannels: [],
        });
        
        const remoteRooms = await this.roomStore.getEntriesByRemoteRoomData({discord_channel: channel.id});
        if (remoteRooms.length === 0) {
            log.verbose(`Could not find any channels in room store.`);
            return channelState;
        }
        
        const patternMap = {
            name: "#" + channel.name,
            guild: channel.guild.name,
        };
        let name = this.config.channel.namePattern;
        for (const p of Object.keys(patternMap)) {
            name = name.replace(new RegExp(":" + p, "g"), patternMap[p]);
        }
        const topic = channel.topic;
        const icon = channel.guild.icon;
        let iconUrl = null;
        if (icon) {
            iconUrl = `https://cdn.discordapp.com/icons/${channel.guild.id}/${icon}.png`;
        }
        remoteRooms.forEach((remoteRoom) => {
            const mxid = remoteRoom.matrix.getId();
            const singleChannelState = Object.assign({}, DEFAULT_SINGLECHANNEL_STATE, {
                mxid,
            });
            
            const oldName = remoteRoom.remote.get("discord_name");
            if (remoteRoom.remote.get("update_name") && (forceUpdate || oldName !== name)) {
                log.verbose(`Channel ${mxid} name should be updated`);
                singleChannelState.name = name;
            }
            
            const oldTopic = remoteRoom.remote.get("discord_topic");
            if (remoteRoom.remote.get("update_topic") && (forceUpdate || oldTopic !== topic)) {
                log.verbose(`Channel ${mxid} topic should be updated`);
                singleChannelState.topic = topic;
            }
            
            const oldIconUrl = remoteRoom.remote.get("discord_iconurl");
            if (remoteRoom.remote.get("update_icon") && oldIconUrl !== iconUrl) { // no force on icon update as we don't want to duplicate ALL the icons
                log.verbose(`Channel ${mxid} icon should be updated`);
                if (iconUrl !== null) {
                    singleChannelState.iconUrl = iconUrl;
                    singleChannelState.iconId = icon;
                } else {
                    singleChannelState.removeIcon = oldIconUrl !== null;
                }
            }
            channelState.mxChannels.push(singleChannelState);
        });
        return channelState;
    }

    public async EnsureState(channel: Discord.TextChannel) {
        const state = await this.GetChannelUpdateState(channel, true);
        log.info(`Ensuring ${state.id} to be correct`);
        await this.ApplyStateToChannel(state);
    }

    private async ApplyStateToChannel(channelsState: IChannelState) {
        const intent = this.bridge.getIntent();
        for (const channelState of channelsState.mxChannels) {
            let roomUpdated = false;
            const remoteRoom = (await this.roomStore.getEntriesByMatrixId(channelState.mxid))[0];
            if (channelState.name !== null) {
                log.verbose(`Updating channelname for ${channelState.mxid} to "${channelState.name}"`);
                await intent.setRoomName(channelState.mxid, channelState.name);
                remoteRoom.remote.set("discord_name", channelState.name);
                roomUpdated = true;
            }
            
            if (channelState.topic !== null) {
                log.verbose(`Updating channeltopic for ${channelState.mxid} to "${channelState.topic}"`);
                await intent.setRoomTopic(channelState.mxid, channelState.topic);
                remoteRoom.remote.set("discord_topic", channelState.topic);
                roomUpdated = true;
            }
            
            if (channelState.iconUrl !== null) {
                log.verbose(`Updating icon_url for ${channelState.mxid} to "${channelState.iconUrl}"`);
                if (channelsState.iconMxcUrl === null) {
                    const iconMxc = await Util.UploadContentFromUrl(
                        channelState.iconUrl,
                        intent,
                        channelState.iconId,
                    );
                    channelsState.iconMxcUrl = iconMxc.mxcUrl;
                }
                await intent.setRoomAvatar(channelState.mxid, channelsState.iconMxcUrl);
                remoteRoom.remote.set("discord_iconurl", channelState.iconUrl);
                remoteRoom.remote.set("discord_iconurl_mxc", channelsState.iconMxcUrl);
                roomUpdated = true;
            }
            
            if (channelState.removeIcon) {
                log.verbose(`Clearing icon_url for ${channelState.mxid}`);
                await intent.setRoomAvatar(channelState.mxid, null);
                remoteRoom.remote.set("discord_iconurl", null);
                remoteRoom.remote.set("discord_iconurl_mxc", null);
                roomUpdated = true;
            }
            
            if (roomUpdated) {
                await this.roomStore.upsertEntry(remoteRoom);
            }
        }
    }

    private async handleChannelDeletionForRoom(
        channel: Discord.TextChannel,
        roomId: string,
        entry: any): Promise<void> {
        log.info(`Deleting ${channel.id} from ${roomId}.`);
        const intent = await this.bridge.getIntent();
        const options = this.config.channel.deleteOptions;
        const plumbed = entry.remote.get("plumbed");

        this.roomStore.upsertEntry(entry);
        if (options.ghostsLeave) {
            for (const member of channel.members.array()){
                try {
                    const mIntent = await this.bot.GetIntentFromDiscordMember(member);
                    mIntent.leave(roomId);
                    log.info(`${member.id} left ${roomId}.`);
                } catch (e) {
                    log.warn(`Failed to make ${member.id} leave `);
                }
            }
        }
        if (options.namePrefix) {
            try {
                const name = await intent.getClient().getStateEvent(roomId, "m.room.name");
                name.name = options.namePrefix + name.name;
                await intent.getClient().setRoomName(roomId, name.name);
            } catch (e) {
                log.error(`Failed to set name of room ${roomId} ${e}`);
            }
        }
        if (options.topicPrefix) {
            try {
                const topic = await intent.getClient().getStateEvent(roomId, "m.room.topic");
                topic.topic = options.topicPrefix + topic.topic;
                await intent.getClient().setRoomTopic(roomId, topic.topic);
            } catch (e) {
                log.error(`Failed to set topic of room ${roomId} ${e}`);
            }
        }
        
        if (plumbed !== true) {
            if (options.unsetRoomAlias) {
                try {
                    const alias = "#_" + entry.remote.roomId + ":" + this.config.bridge.domain;
                    const canonicalAlias = await intent.getClient().getStateEvent(roomId, "m.room.canonical_alias");
                    if (canonicalAlias.alias === alias) {
                        await intent.getClient().sendStateEvent(roomId, "m.room.canonical_alias", {});
                    }
                    await intent.getClient().deleteAlias(alias);
                } catch (e) {
                    log.error(`Couldn't remove alias of ${roomId} ${e}`);
                }
            }

            if (options.unlistFromDirectory) {
                try {
                    await intent.getClient().setRoomDirectoryVisibility(roomId, "private");
                } catch (e) {
                    log.error(`Couldn't remove ${roomId} from room directory ${e}`);
                }

            }

            if (options.setInviteOnly) {
                try {
                    await intent.getClient().sendStateEvent(roomId, "m.room.join_rules", {join_role: "invite"});
                } catch (e) {
                    log.error(`Couldn't set ${roomId} to private ${e}`);
                }
            }

            if (options.disableMessaging) {
                try {
                    const state = await intent.getClient().getStateEvent(roomId, "m.room.power_levels");
                    state.events_default = POWER_LEVEL_MESSAGE_TALK;
                    await intent.getClient().sendStateEvent(roomId, "m.room.power_levels", state);
                } catch (e) {
                    log.error(`Couldn't disable messaging for ${roomId} ${e}`);
                }
            }
        }
        // Unlist

        // Remove entry
        await this.roomStore.removeEntriesByMatrixRoomId(roomId);
    }
}
