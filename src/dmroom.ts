import { Snowflake, Client, TextChannel, Collection, GuildMember, Channel, DMChannel, GroupDMChannel, Message, FileOptions, User } from "discord.js";
import { MatrixRoom , Intent} from "matrix-appservice-bridge";
import * as log from "npmlog";
import { DbDmRoom } from "./db/dbdatadmroom";
import { DMHandler } from "./dmhandler";
import { MessageProcessor } from "./messageprocessor";

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
            const c = (<DMChannel>this.channel);
            return [c.client.user.id, c.recipient.id];
        } else if (this.channel.type === "group") {
            return (<GroupDMChannel>this.channel).recipients.keyArray();
        }
    };

    public HydrateRoomWithDiscord(discordClient: Client) {
        const channel = discordClient.channels.get(this.dbroom.ChannelId);
        if (channel === undefined) {
            log.warn("DMRoom", "HydrateRoomWithDiscord was given a client that didn't have the channel.");
            throw new Error("Channel not found for client!");
        }
        if (!["dm", "group"].includes(channel.type)) {
            log.warn("DMRoom", "HydrateRoomWithDiscord was given a channel that was not a dm|group.");
            throw new Error("Channel is not a dm|group");
        }
        this.channel = <DMChannel|GroupDMChannel> channel;
        log.verbose("DMRoom", `${this.dbroom.ChannelId} has ${this.discordUserIDs.length} discord members`);
    }

    public async HydrateRoomWithMatrix(matrixClient: Intent): Promise<void>{
        const roomState: any[] = await matrixClient.roomState(this.dbroom.RoomId);
        roomState.forEach(element => {
            if (element.type === "m.room.member" &&
                element.content.membership === "join") {
                this.matrixMembers.add(element.sender);
            }
        });
        log.info("DMRoom", `${this.dbroom.RoomId} has ${this.matrixMembers.size} matrix members (including virtual users)`);
    }

    public async OnMatrixEvent(event: any) {
        log.info("DMRoom", `Got matrix message for ${this.dbroom.ChannelId}`);
        let client: Client;
        try {
            client = await this.handler.ClientFactory.getClient(event.sender);
        } catch (e) {
            log.error("DMRoom", `Could not get client for ${event.sender}. Discarding event :(`, e);
            return;
        }
        const channel = <DMChannel|GroupDMChannel> client.channels.get(this.dbroom.ChannelId);
        const msg = this.handler.EventProcessor.EventToEmbed(event, null, channel);
        const intent = this.handler.GetIntentForUser(channel.client.user);
        const file = await this.handler.EventProcessor.HandleAttachment(
            event,
            intent.client
        );
        let payload: any;
        if (typeof(file) === "string") {
            log.verbose("DMRoom", "Sending plaintext message");
            payload = msg.description += " " + file;
        } else {
            log.verbose("DMRoom", "Sending a file");
            payload = file;
        }
        await this.deferLock;
        this.deferLock = new Promise((resolve, _) => {
            return channel.send(payload).then((message) => {
                if (Array.isArray(message)) {
                    message.forEach((msg) => this.sentMessages.add(msg.id));
                    return;
                }
                this.sentMessages.add(message.id);
                resolve();
            }).catch((e) => {
                log.warn("DMRoom", "Failed to sent message", e);
                resolve();
            });
        });
    }

    public async OnInvite(event: any): Promise<void> {

    }

    public async OnDiscordMessage (msg: Message) {
        await this.deferLock;
        if(this.sentMessages.has(msg.id)) {
            return; // Drop echo
        }
        log.info("DMRoom", `Got discord message for ${this.dbroom.ChannelId}`);
        const intent = this.handler.GetIntentForUser(msg.author);
        const matrixMsg = await this.handler.MessageProcessor.FormatDiscordMessage(msg, intent);
        await matrixMsg.attachmentEvents.map((evt) => {
            return intent.sendMessage((this.dbroom.RoomId), evt);
        });

        if(matrixMsg.body === "") {
            return;
        }
        return intent.sendMessage(this.dbroom.RoomId, {
            msgtype: "m.text",
            format: "org.matrix.custom.html",
            body: matrixMsg.body,
            formatted_body: matrixMsg.formattedBody
        });
    }

    public async OnDiscordTyping(user: User, typing: Boolean) {
        log.verbose("DMRoom", `Got typing for ${this.dbroom.ChannelId} ${typing}`);
        const intent = this.handler.GetIntentForUser(user);
        intent.sendTyping(this.RoomId, typing);
    }

}