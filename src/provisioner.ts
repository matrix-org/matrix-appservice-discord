import {
    Bridge,
    RemoteRoom,
    MatrixRoom,
} from "matrix-appservice-bridge";
import * as Discord from "discord.js";
import { Permissions } from "discord.js";

const PERMISSION_REQUEST_TIMEOUT = 300000; // 5 minutes

export class Provisioner {

    private bridge: Bridge;
    private pendingRequests: { [channelId: string]: (approved: boolean) => void } = {}; // [channelId]: resolver fn

    public SetBridge(bridge: Bridge): void {
        this.bridge = bridge;
    }

    public BridgeMatrixRoom(channel: Discord.TextChannel, roomId: string) {
        const remote = new RemoteRoom(`discord_${channel.guild.id}_${channel.id}_bridged`);
        remote.set("discord_type", "text");
        remote.set("discord_guild", channel.guild.id);
        remote.set("discord_channel", channel.id);
        remote.set("plumbed", true);

        const local = new MatrixRoom(roomId);
        this.bridge.getRoomStore().linkRooms(local, remote);
        this.bridge.getRoomStore().setMatrixRoom(local); // Needs to be done after linking
    }

    public UnbridgeRoom(remoteRoom: RemoteRoom) {
        return this.bridge.getRoomStore().removeEntriesByRemoteRoomId(remoteRoom.getId());
    }

    public AskBridgePermission(channel: Discord.TextChannel, requestor: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const channelId = channel.guild.id + "/" + channel.id;

            let responded = false;
            const approveFn = (approved: boolean, expired = false) => {
                if (responded) {
                    return;
                }

                responded = true;
                delete this.pendingRequests[channelId];
                if (approved) {
                    resolve();
                } else {
                    if (expired) {
                        reject(new Error("Timed out waiting for a response from the Discord owners"));
                    } else {
                        reject(new Error("The bridge has been declined by the Discord guild"));
                    }
                }
            };

            this.pendingRequests[channelId] = approveFn;
            setTimeout(() => approveFn(false, true), PERMISSION_REQUEST_TIMEOUT);

            channel.sendMessage(requestor + " on matrix would like to bridge this channel. Someone with permission" +
                " to manage webhooks please reply with !approve or !deny in the next 5 minutes");
        });
    }

    public HasPendingRequest(channel: Discord.TextChannel): boolean {
        const channelId = channel.guild.id + "/" + channel.id;
        return !!this.pendingRequests[channelId];
    }

    public MarkApproved(channel: Discord.TextChannel, member: Discord.GuildMember, allow: boolean): Promise<boolean> {
        const channelId = channel.guild.id + "/" + channel.id;
        if (!this.pendingRequests[channelId]) {
            return Promise.resolve(false); // no change, so false
        }

        const perms = channel.permissionsFor(member);
        if (!perms.hasPermission(Permissions.FLAGS.MANAGE_WEBHOOKS)) {
            // Missing permissions, so just reject it
            return Promise.reject(new Error("You do not have permission to manage webhooks in this channel"));
        }

        this.pendingRequests[channelId](allow);
        return Promise.resolve(true); // replied, so true
    }
}
