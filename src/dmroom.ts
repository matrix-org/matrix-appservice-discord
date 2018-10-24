import { Client, DMChannel, GroupDMChannel, Message, User } from "discord.js";
import { Intent} from "matrix-appservice-bridge";
import { DbDmRoom } from "./db/dbdatadmroom";
import { DMHandler } from "./dmhandler";
import { Util } from "./util";
import { Log } from "./log";

const log = new Log("DMRoom");

export class DMRoom {
    private matrixMembers: Set<string>;
    private sentMessages: Set<string>;
    private deferLock: Promise<any>;
    /* There are unfortunately a few differences between
    the two chan types which means we will be doing a lot of
    if elseing between them.*/
    private channel: DMChannel|GroupDMChannel;

    constructor(private dbroom: DbDmRoom, private handler: DMHandler) {
        this.deferLock = Promise.resolve();
        this.sentMessages = new Set();
    }

    public get DiscordChannelId() {
        return this.dbroom.ChannelId;
    }

    public get RoomId() {
        return this.dbroom.RoomId;
    }

    get discordUserIDs() {
        if (this.channel.type === "dm") {
            const c = (<DMChannel> this.channel);
            return [c.client.user.id, c.recipient.id];
        } else if (this.channel.type === "group") {
            return (<GroupDMChannel> this.channel).recipients.keyArray();
        }
    };

    public HydrateRoomWithDiscord(discordClient: Client) {
        const channel = discordClient.channels.get(this.dbroom.ChannelId);
        if (channel === undefined) {
            log.warn("HydrateRoomWithDiscord was given a client that didn't have the channel.");
            throw new Error("Channel not found for client!");
        }
        if (!["dm", "group"].includes(channel.type)) {
            log.warn("HydrateRoomWithDiscord was given a channel that was not a dm|group.");
            throw new Error("Channel is not a dm|group");
        }
        this.channel = <DMChannel|GroupDMChannel> channel;
        log.verbose(`${this.dbroom.ChannelId} has ${this.discordUserIDs.length} discord members`);
    }

    public async HydrateRoomWithMatrix(matrixClient: Intent): Promise<void> {
        const roomState: any[] = await matrixClient.roomState(this.dbroom.RoomId);
        roomState.forEach((element) => {
            if (element.type === "m.room.member" &&
                element.content.membership === "join") {
                this.matrixMembers.add(element.sender);
            }
        });
        log.info(`${this.dbroom.RoomId} has ${this.matrixMembers.size} matrix members (including virtual users)`);
    }

    public async OnMatrixEvent(event: any) {
        log.info(`Got matrix message for ${this.dbroom.ChannelId}`);
        let client: Client;
        try {
            client = await this.handler.ClientFactory.getClient(event.sender);
        } catch (e) {
            log.error(`Could not get client for ${event.sender}. Discarding event :(`, e);
            return;
        }
        const channel = <DMChannel|GroupDMChannel> client.channels.get(this.dbroom.ChannelId);
        const msg = this.handler.EventProcessor.EventToEmbed(event, null, channel);
        const intent = this.handler.GetIntentForUser(channel.client.user);
        const file = await this.handler.EventProcessor.HandleAttachment(
            event,
            intent.client,
        );
        let payload: any;
        if (typeof(file) === "string") {
            log.verbose("Sending plaintext message");
            payload = msg.description += " " + file;
        } else {
            log.verbose("Sending a file");
            payload = {files: [file]};
        }
        await this.deferLock;
        this.deferLock = (async () => {
            try {
                const message = await channel.send(payload);
                if (Array.isArray(message)) {
                    message.forEach((sentMessage) => this.sentMessages.add(sentMessage.id));
                    return;
                }
                this.sentMessages.add(message.id);
            } catch (e) {
                log.warn("Failed to sent message", e);
            }
        })();
    }

    public async OnInvite(event: any): Promise<void> {

    }

    public async OnDiscordMessage (msg: Message) {
        await this.deferLock;
        if (this.sentMessages.has(msg.id)) {
            return; // Drop echo
        }
        log.info(`Got discord message for ${this.dbroom.ChannelId}`);
        try {
            const intent = this.handler.GetIntentForUser(msg.author);
            const matrixMsg = await this.handler.MessageProcessor.FormatDiscordMessage(msg, intent);
            await Promise.all(matrixMsg.attachmentEvents.map((evt) => {
                return intent.sendMessage((this.dbroom.RoomId), evt);
            }));

            if (matrixMsg.body === "") {
                return;
            }
            await intent.join(this.dbroom.RoomId);
            await intent.sendMessage(this.dbroom.RoomId, {
                msgtype: "m.text",
                format: "org.matrix.custom.html",
                body: matrixMsg.body,
                formatted_body: matrixMsg.formattedBody,
            });
        } catch (e) {
            log.error("Failed to handle discord message", e);
        }
    }

    public async OnDiscordTyping(user: User, typing: Boolean) {
        log.verbose(`Got typing for ${this.dbroom.ChannelId} ${typing}`);
        const intent = this.handler.GetIntentForUser(user);
        intent.sendTyping(this.RoomId, typing);
    }

    public UpdateName(user: User, name: string) {
        log.info(`Updating name for ${this.RoomId}`);
        const intent = this.handler.GetIntentForUser(user);
        intent.setRoomName(this.RoomId, name);
    }

    public async UpdateAvatar(user: User, url: string) {
        log.info(`Updating avatar for ${this.RoomId}`);
        const intent = this.handler.GetIntentForUser(user);
        const mxc = await Util.UploadContentFromUrl(url, intent, null);
        intent.setRoomAvatar(this.RoomId, mxc.mxcUrl);
    }

    public async AddToRoom(user: User, newUser: User) {
        log.info(`Adding ${newUser.id} to ${this.RoomId}`);
        const intent = this.handler.GetIntentForUser(user);
        const intentNew = this.handler.GetIntentForUser(newUser);
        await intent.invite(this.RoomId, this.handler.GetMatrixIdForUser(newUser));
        intentNew.join(this.RoomId);
    }

    public KickFromRoom(user: User, kickee: User) {
        log.info(`Kicking ${kickee.id} from ${this.RoomId}`);
        const intent = this.handler.GetIntentForUser(user);
        const intentKicked = this.handler.GetIntentForUser(kickee);
        intent.sendMessage(this.RoomId, {msgtype: "m.notice", body: "Kicking user from room."});
        intentKicked.leave(this.RoomId);
    }

}
