import { Snowflake, Client, TextChannel, Collection, GuildMember } from "discord.js";
import { MatrixRoom , Intent} from "matrix-appservice-bridge";
import * as log from "npmlog";

export class DMRoom {
    private matrixMembers: Set<string>;
    private discordMembers: Collection<string, GuildMember>;
    
    constructor(private id: Snowflake, private matrixRoom: MatrixRoom) {

    }

    public HydrateRoomWithDiscord(discordClient: Client) {
        const channel = discordClient.channels.get(this.id);
        if (channel === undefined) {
            log.warn("DMRoom", "HydrateRoomWithDiscord was given a client that didn't have the channel.");
            throw new Error("Channel not found for client!");
        }
        if (!["dm", "group"].includes(channel.type)) {
            log.warn("DMRoom", "HydrateRoomWithDiscord was given a channel that was not a dm|group.");
            throw new Error("Channel is not a dm|group");
        }
        this.discordMembers = (channel as TextChannel).members;
        log.verbose("DMRoom", `${this.id} has ${this.discordMembers.size} discord members`);
    }

    public async HydrateRoomWithMatrix(matrixClient: Intent): Promise<void>{
        const roomState: any[] = await matrixClient.roomState(this.matrixRoom.getId());
        roomState.forEach(element => {
            if (element.type === "m.room.member" &&
                element.content.membership === "join") {
                this.matrixMembers.add(element.sender);
            }
        });
        log.info("DMRoom", `${this.matrixRoom.getId()} has ${this.matrixMembers.size} matrix members (including virtual users)`);
    }

    public async OnMatrixEvent(event: any) {

    }

    public async OnInvite(event: any): Promise<InviteAction> {

    }

    public async OnDiscordMessage (event: any) {

    }

}