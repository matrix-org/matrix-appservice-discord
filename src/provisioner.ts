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

import {
    Bridge,
    RemoteRoom,
    MatrixRoom,
} from "matrix-appservice-bridge";
import * as Discord from "discord.js";
import { DbRoomStore } from "./db/roomstore";

const PERMISSION_REQUEST_TIMEOUT = 300000; // 5 minutes

export class Provisioner {

    private pendingRequests: Map<string, (approved: boolean) => void> = new Map(); // [channelId]: resolver fn

    constructor(private roomStore: DbRoomStore) { }

    public async BridgeMatrixRoom(channel: Discord.TextChannel, roomId: string) {
        const remote = new RemoteRoom(`discord_${channel.guild.id}_${channel.id}_bridged`);
        remote.set("discord_type", "text");
        remote.set("discord_guild", channel.guild.id);
        remote.set("discord_channel", channel.id);
        remote.set("plumbed", true);

        const local = new MatrixRoom(roomId);
        return this.roomStore.linkRooms(local, remote);
    }

    public async UnbridgeRoom(remoteRoom: RemoteRoom) {
        return this.roomStore.removeEntriesByRemoteRoomId(remoteRoom.getId());
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
                    reject(Error("Timed out waiting for a response from the Discord owners"));
                } else {
                    reject(Error("The bridge has been declined by the Discord guild"));
                }
            }
        };

        this.pendingRequests.set(channelId, approveFn);
        setTimeout(() => approveFn(false, true), timeout);

        await channel.send(`${requestor} on matrix would like to bridge this channel. Someone with permission` +
            " to manage webhooks please reply with `!matrix approve` or `!matrix deny` in the next 5 minutes");
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
