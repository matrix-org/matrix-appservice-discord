import { Snowflake, Client, TextChannel, Collection, GuildMember, Channel, DMChannel, GroupDMChannel, Message } from "discord.js";
import { MatrixRoom , Intent} from "matrix-appservice-bridge";
import * as log from "npmlog";
import { DbDmRoom } from "./db/dbdatadmroom";
import { DMHandler } from "./dmhandler";
import { MessageProcessor } from "./messageprocessor";

export class DMRoom {
    private matrixMembers: Set<string>;
    /* There are unfortunately a few differences between
    the two chan types which means we will be doing a lot of
    if elseing between them.*/
    private channel: DMChannel|GroupDMChannel;
    
    constructor(private dbroom: DbDmRoom, private handler: DMHandler) {

    }

    public get DiscordChannelId() {
        return this.dbroom.ChannelId;
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

    }

    public async OnInvite(event: any): Promise<void> {

    }

    public async OnDiscordMessage (msg: Message) {
        log.info("DMRoom", `Got discord message for ${this.dbroom.ChannelId}`);
        const intent = this.handler.GetIntentForUser(msg.author);
        const matrixMsg = await this.handler.MessageProcessor.FormatDiscordMessage(msg);
        return intent.sendMessage(this.dbroom.RoomId, {
            msgtype: "m.text",
            format: "org.matrix.custom.html",
            body: matrixMsg.body,
            formatted_body: matrixMsg.formattedBody
        });
    }

}