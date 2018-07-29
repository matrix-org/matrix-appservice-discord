import {
    Bridge,
    RemoteRoom,
    MatrixRoom,
} from "matrix-appservice-bridge";
import * as Discord from "discord.js";
import * as Bluebird from "bluebird";
import { Permissions } from "discord.js";
import { DiscordBot } from "./bot";

const PERMISSION_REQUEST_TIMEOUT = 300000; // 5 minutes

export class Provisioner {

    private bridge: Bridge;
    private discord: DiscordBot;
    private pendingRequests: { [channelId: string]: (approved: boolean) => void } = {}; // [channelId]: resolver fn

    public SetBridge(bridge: Bridge): void {
        this.bridge = bridge;
    }

    public SetDiscordbot(discord: DiscordBot): void {
        this.discord = discord;
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

    public async HandleDiscordCommand(msg: Discord.Message) {
        if (!msg.member.hasPermission("ADMINISTRATOR")) {
            msg.channel.sendMessage("**ERROR:** insufficiant permissions to use matrix commands");
            return;
        }
        const prefix = "!matrix ";
        let command = "help";
        let args = [];
        if (msg.content.length >= prefix.length) {
            const allArgs = msg.content.substring(prefix.length).split(" ");
            if (allArgs.length && allArgs[0] !== "") {
                command = allArgs[0];
                allArgs.splice(0, 1);
                args = allArgs;
            }
        }
        
        let replyMessage = "Error, unkown command. Try `!matrix help` to see all commands";
        
        const intent = this.bridge.getIntent();
        const doAction = async (funcKey, action) => {
            const name = args.join(" ");
            const channels = await this.discord.GetRoomIdsFromChannel(msg.channel);
            try {
                const userMxid = await this.GetMxidFromName(name, channels);
                await Bluebird.all(channels.map((c) => {
                    console.log(c);
                    console.log(userMxid);
                    return intent[funcKey](c, userMxid);
                }));
                replyMessage = `${action} ${userMxid}`;
            } catch (e) {
                console.log(e);
                replyMessage = "**Error:** " + e.message;
            }
        };
        
        switch (command) {
            case "help":
                replyMessage = "Available Messages:\n" +
                    " - `kick <name>`: Kicks a user on the matrix side\n" +
                    " - `ban <name>`: Bans a user on the matrix side\n" +
                    " - `unban <name>`: Unbans a user on the matrix side\n\n" +
                    "The name must be the display name or the mxid of the user to perform the action on.";
                break;
            case "kick":
                await doAction("kick", "Kicked");
                break;
            case "ban":
                await doAction("ban", "Banned");
                break;
            case "unban":
                await doAction("unban", "Unbanned");
                break;
        }
        
        msg.channel.send(replyMessage);
    }

    private async GetMxidFromName(name: string, channels: string[]) {
        if (name[0] === "@" && name.includes(":")) {
            return name;
        }
        const client = this.bridge.getIntent().getClient();
        const matrixUsers = {};
        let matches = 0;
        await Bluebird.all(channels.map((c) => {
            // we would use this.bridge.getBot().getJoinedMembers()
            // but we also want to be able to search through banned members
            // so we gotta roll our own thing
            return client._http.authedRequestWithPrefix(
                undefined, "GET", "/rooms/" + encodeURIComponent(c) + "/members",
                undefined, undefined, "/_matrix/client/r0"
            ).then((res) => {
                res.chunk.forEach((member) => {
                    if (member.membership !== "join" && member.membership !== "ban") {
                        return;
                    }
                    const mxid = member.state_key;
                    if (mxid.startsWith("@_discord_")) {
                        return;
                    }
                    let displayName = member.content.displayname;
                    console.log("=====");
                    console.log(displayName);
                    if (!displayName && member.unsigned && member.unsigned.prev_content && member.unsigned.prev_content.displayname) {
                        displayName = member.unsigned.prev_content.displayname;
                    }
                    console.log(displayName);
                    if (!displayName) {
                        displayName = mxid.substring(1, mxid.indexOf(":"));
                    }
                    if (name.toLowerCase() === displayName.toLowerCase() || name === mxid) {
                        matrixUsers[mxid] = displayName;
                        matches++;
                    }
                });
            });
        }));
        if (matches === 0) {
            throw Error(`No users matching ${name} found`);
        }
        if (matches > 1) {
            let errStr = "Multiple matching users found:\n";
            for (const mxid of Object.keys(matrixUsers)) {
                errStr += `${matrixUsers[mxid]} (\`${mxid}\`)\n`;
            }
            throw Error(errStr);
        }
        return Object.keys(matrixUsers)[0];
    }
}
