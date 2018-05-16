import {Channel, default as Discord, TextChannel} from "discord.js";
import * as log from "npmlog";
import {DiscordBot} from "./bot";
import {DiscordBridgeConfig} from "./config";

export class ChannelHandler {

    constructor(private bot: DiscordBot, private bridge: any, private config: DiscordBridgeConfig) { }

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
            entries = this.bridge.getRoomStore().getEntriesByMatrixIds(roomids);
        } catch (e) {
            log.warn("ChannelHandler", `Couldn't find roomids for deleted channel ${channel.id}`);
            return;
        }
        for (const roomid of roomids){
            try {
                await this.handleChannelDeletionForRoom(channel as Discord.TextChannel, roomid, entries[roomid]);
            } catch (e) {
                log.error("ChannelHandler", `Failed to delete channel from room: ${e}`);
            }
        }
    }

    public GetRoomIdsFromChannel(channel: Discord.Channel): Promise<string[]> {
        return this.bridge.getRoomStore().getEntriesByRemoteRoomData({
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
        const options = this.config.channel.deleteChannelOptions;
        const plumbed = entry.remote.get("plumbed");

        this.bridge.getRoomStore().upsertEntry(entry);
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
        // Remove alias
        if (plumbed !== true) {
            if (options.unlistFromDirectory) {
                try {
                    await intent.getClient().setRoomDirectoryVisibility(roomId, "private");
                } catch (e) {
                    log.error("ChannelHandler", `Couldn't remove ${roomId} from room directory`);
                }

            }

            if (options.setInviteOnly) {
                // await intent.sendStateEvent
            }
        }
        // Unlist

        // Remove entry
        await this.bridge.getRoomStore().removeEntriesByMatrixRoomId(roomId);
    }
}