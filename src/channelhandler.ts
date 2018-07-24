import {Channel, TextChannel} from "discord.js";
import * as Discord from "discord.js";
import * as log from "npmlog";
import {DiscordBot} from "./bot";
import {DiscordBridgeConfig} from "./config";
import { Bridge, RoomBridgeStore } from "matrix-appservice-bridge";

const POWER_LEVEL_MESSAGE_TALK = 50;

export class ChannelHandler {

    private roomStore: RoomBridgeStore;
    constructor(
        private bridge: Bridge,
        private config: DiscordBridgeConfig,
        private bot: DiscordBot) {
        this.roomStore = this.bridge.getRoomStore();
    }

    public async HandleChannelDelete(channel: Channel) {
        if (channel.type !== "text") {
            log.info("ChannelHandler", `Channel ${channel.id} was deleted but isn't a text channel, so ignoring.`);
            return;
        }
        log.info("ChannelHandler", `Channel ${channel.id} has been deleted.`);
        let roomids;
        let entries;
        try {
            roomids = await this.GetRoomIdsFromChannel(channel);
            entries = await this.roomStore.getEntriesByMatrixIds(roomids);
        } catch (e) {
            log.warn("ChannelHandler", `Couldn't find roomids for deleted channel ${channel.id}`);
            return;
        }
        for (const roomid of roomids){
            try {
                await this.handleChannelDeletionForRoom(channel as Discord.TextChannel, roomid, entries[roomid][0]);
            } catch (e) {
                log.error("ChannelHandler", `Failed to delete channel from room: ${e}`);
            }
        }
    }

    public GetRoomIdsFromChannel(channel: Discord.Channel): Promise<string[]> {
        return this.roomStore.getEntriesByRemoteRoomData({
            discord_channel: channel.id,
        }).then((rooms) => {
            if (rooms.length === 0) {
                log.verbose("ChannelHandler", `Couldn"t find room(s) for channel ${channel.id}.`);
                return Promise.reject("Room(s) not found.");
            }
            return rooms.map((room) => room.matrix.getId() as string);
        });
    }

    private async handleChannelDeletionForRoom(
        channel: Discord.TextChannel,
        roomId: string,
        entry: any): Promise<void> {
        log.info("ChannelHandler", `Deleting ${channel.id} from ${roomId}.`);
        const intent = await this.bridge.getIntent();
        const options = this.config.channel.deleteOptions;
        const plumbed = entry.remote.get("plumbed");

        this.roomStore.upsertEntry(entry);
        if (options.ghostsLeave) {
            for (const member of channel.members.array()){
                try {
                    const mIntent = await this.bot.GetIntentFromDiscordMember(member);
                    mIntent.leave(roomId);
                    log.info("ChannelHandler", `${member.id} left ${roomId}.`);
                } catch (e) {
                    log.warn("ChannelHandler", `Failed to make ${member.id} leave `);
                }
            }
        }
        if (options.namePrefix) {
            try {
                const name = await intent.getClient().getStateEvent(roomId, "m.room.name");
                name.name = options.namePrefix + name.name;
                await intent.getClient().setRoomName(roomId, name.name);
            } catch (e) {
                log.error("ChannelHandler", `Failed to set name of room ${roomId} ${e}`);
            }
        }
        if (options.topicPrefix) {
            try {
                const topic = await intent.getClient().getStateEvent(roomId, "m.room.topic");
                topic.topic = options.topicPrefix + topic.topic;
                await intent.getClient().setRoomTopic(roomId, topic.topic);
            } catch (e) {
                log.error("ChannelHandler", `Failed to set topic of room ${roomId} ${e}`);
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
                    log.error("ChannelHandler", `Couldn't remove alias of ${roomId} ${e}`);
                }
            }

            if (options.unlistFromDirectory) {
                try {
                    await intent.getClient().setRoomDirectoryVisibility(roomId, "private");
                } catch (e) {
                    log.error("ChannelHandler", `Couldn't remove ${roomId} from room directory ${e}`);
                }

            }

            if (options.setInviteOnly) {
                try {
                    await intent.getClient().sendStateEvent(roomId, "m.room.join_rules", {join_role: "invite"});
                } catch (e) {
                    log.error("ChannelHandler", `Couldn't set ${roomId} to private ${e}`);
                }
            }

            if (options.disableMessaging) {
                try {
                    const state = await intent.getClient().getStateEvent(roomId, "m.room.power_levels");
                    state.events_default = POWER_LEVEL_MESSAGE_TALK;
                    await intent.getClient().sendStateEvent(roomId, "m.room.power_levels", state);
                } catch (e) {
                    log.error("ChannelHandler", `Couldn't disable messaging for ${roomId} ${e}`);
                }
            }
        }
        // Unlist

        // Remove entry
        await this.roomStore.removeEntriesByMatrixRoomId(roomId);
    }
}
