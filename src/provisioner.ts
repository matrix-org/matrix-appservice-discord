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

import * as Discord from "@mx-puppet/better-discord.js";
import { DbRoomStore, RemoteStoreRoom, MatrixStoreRoom } from "./db/roomstore";
import { ChannelSyncroniser } from "./channelsyncroniser";
import { Log } from "./log";

const PERMISSION_REQUEST_TIMEOUT = 300000; // 5 minutes

const log = new Log("Provisioner");

export class Provisioner {

    private pendingRequests: Map<string, (approved: boolean) => void> = new Map(); // [channelId]: resolver fn

    constructor(private roomStore: DbRoomStore, private channelSync: ChannelSyncroniser) { }

    public async BridgeMatrixRoom(channel: Discord.TextChannel, roomId: string) {
        const remote = new RemoteStoreRoom(`discord_${channel.guild.id}_${channel.id}_bridged`, {
            discord_channel: channel.id,
            discord_guild: channel.guild.id,
            discord_type: "text",
            plumbed: true,
        });
        const local = new MatrixStoreRoom(roomId);
        return this.roomStore.linkRooms(local, remote);
    }

    /**
     * Returns if the room count limit has been reached.
     * This can be set by the bridge admin and prevents new rooms from being bridged.
     * @returns Has the limit been reached?
     */
    public async RoomCountLimitReached(limit: number): Promise<boolean> {
        return limit >= 0 && await this.roomStore.countEntries() >= limit;
    }

    public async UnbridgeChannel(channel: Discord.TextChannel, rId?: string) {
        const roomsRes = await this.roomStore.getEntriesByRemoteRoomData({
            discord_channel: channel.id,
            discord_guild: channel.guild.id,
            plumbed: true,
        });
        if (roomsRes.length === 0) {
            throw Error("Channel is not bridged");
        }
        const remoteRoom = roomsRes[0].remote as RemoteStoreRoom;
        let roomsToUnbridge: string[] = [];
        if (rId) {
            roomsToUnbridge = [rId];
        } else {
            // Kill em all.
            roomsToUnbridge = roomsRes.map((entry) => entry.matrix!.roomId);
        }
        await Promise.all(roomsToUnbridge.map( async (roomId) => {
            try {
                await this.channelSync.OnUnbridge(channel, roomId);
            } catch (ex) {
                log.error(`Failed to cleanly unbridge ${channel.id} ${channel.guild} from ${roomId}`, ex);
            }
        }));
        await this.roomStore.removeEntriesByRemoteRoomId(remoteRoom.getId());
    }

    public async AskBridgePermission(
        channel: Discord.TextChannel,
        requestor: string,
        timeout: number = PERMISSION_REQUEST_TIMEOUT): Promise<string> {
        const channelId = `${channel.guild.id}/${channel.id}`;

        let responded = false;
        let resolve: (msg: string) => void;
        let reject: (err: Error) => void;
        const deferP: Promise<string> = new Promise((res, rej) => {resolve = res; reject = rej; });

        const approveFn = (approved: boolean, expired = false) => {
            if (responded) {
                return;
            }

            responded = true;
            this.pendingRequests.delete(channelId);
            if (approved) {
                resolve("Approved");
            } else {
                if (expired) {
                    reject(Error("Timed out waiting for a response from the Discord owners."));
                } else {
                    reject(Error("The bridge has been declined by the Discord guild."));
                }
            }
        };

        this.pendingRequests.set(channelId, approveFn);
        setTimeout(() => approveFn(false, true), timeout);

        await channel.send(`${requestor} on matrix would like to bridge this channel. Someone with permission` +
            " to manage webhooks please reply with `!matrix approve` or `!matrix deny` in the next 5 minutes.");
        return await deferP;

    }

    public HasPendingRequest(channel: Discord.TextChannel): boolean {
        const channelId = `${channel.guild.id}/${channel.id}`;
        return this.pendingRequests.has(channelId);
    }

    public async MarkApproved(
        channel: Discord.TextChannel,
        member: Discord.GuildMember,
        allow: boolean,
    ): Promise<boolean> {
        const channelId = `${channel.guild.id}/${channel.id}`;
        if (!this.pendingRequests.has(channelId)) {
            return false; // no change, so false
        }

        const perms = channel.permissionsFor(member);
        if (!perms || !perms.has(Discord.Permissions.FLAGS.MANAGE_WEBHOOKS as Discord.PermissionResolvable)) {
            // Missing permissions, so just reject it
            throw new Error("You do not have permission to manage webhooks in this channel");
        }

        this.pendingRequests.get(channelId)!(allow);
        return true; // replied, so true
    }
}
