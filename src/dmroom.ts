import { TextBasedChannel, Snowflake, Invite, Client } from "discord.js";
import { MatrixRoom } from "matrix-appservice-bridge";

export interface InviteAction {

}

export class DMRoom {
    private matrixMembers: Set<string>;
    private discordMembers: Set<string>;
    
    constructor(private id: Snowflake, private matrixRoom: MatrixRoom) {

    }

    public HydrateRoomWithClient(discordClient: Client) {

    }

    public async OnMatrixEvent(event: any) {

    }

    public async OnInvite(event: any): Promise<InviteAction> {

    }

    public async OnDiscordMessage (event: any) {

    }

}