import {DiscordBridgeConfigPuppeting} from "./config";
import {DiscordClientFactory} from "./clientfactory";
import {
    Bridge,
} from "matrix-appservice-bridge";
import * as log from "npmlog";
import {DiscordStore} from "./store";
import {DbDmRoom} from "./db/dbdatadmroom";

const NOT_ENABLED_ERROR =
`
The Discord bridge is not enabled for DM support, so you cannot message this Discord user.
You may leave this room. 
`;

const NOT_DM_ROOM =
`
Inviting Discord user's to rooms is not supported (this room contains more than two members).
`;

const NOT_PUPPETED =
`
Your account is not puppeted, so you cannot talk to Discord user's privately.
You may leave this room. 
`;

const MAX_MEMBERS_FOR_DM = 9;

interface InviteResult {
    valid: boolean;
    message: string;
}

export class DMHandler {

    constructor (
        private config: DiscordBridgeConfigPuppeting,
        private bridge: Bridge,
        private clientFactory: DiscordClientFactory,
        private store: DiscordStore,
        ) {
    }

    public async BindClient(): Promise<void> {

    }

    public async UnbindClient(): Promise<void> {

    }

    public async HandleInvite(event: any) {
        if (!this.bridge.getBot()._isRemoteUser(event.state_key)) {
            log.verbose("DMHandler", `Ignoring invite for ${event.room_id} (${event.sender} invited ${event.state_key})`);
            return;
        }
        log.info("DMHandler", `Got invite for ${event.room_id} (${event.sender} invited ${event.state_key})`);

        let discordUserId = null;
        try {
            const discordUsers = await this.bridge.getUserStore().getRemoteUsersFromMatrixId(
                event.state_key.substr("@".length),
            );
            if ( discordUsers.length === 0) {
                log.warn("DMHandler", "Got an invite for a virtual user the bridge doesn't know about!");
                return;
            }
            discordUserId = discordUsers[0].getId();
        } catch (e) {
            log.warn("DMHandler", "There was an error trying to fetch a remote user from the store!", e);
            return;
        }

        const result = await this.CheckInvite(event);
        if (result.valid === false) {
            const userIntent = this.bridge.getIntent(event.state_key);
            try {
                await userIntent.sendMessage(event.room_id, {
                    msgtype: "m.notice",
                    body: result.message,
                });
            } catch (e) {
                // Uh..we can't send a message? Oh well, leave anyway.
            }
            return userIntent.leave(event.room_id);
        }

        const existingDMRoom = new DbDmRoom();
        await existingDMRoom.RunQuery(this.store, {user_id: event.sender, discord_id: discordUserId});
        if (existingDMRoom.Result === true) {
            log.info("DMHandler", "User already has a DM room with this user, dropping the old one.");
            const userIntent = this.bridge.getIntent(event.state_key);
            await existingDMRoom.Delete(this.store);
            try {
                await userIntent.kick(existingDMRoom.RoomId, event.state_key, "New DM Room created.");
            } catch (e) {
                log.warn("DMHandler", "Failed to kick self from old DM room.", e);
            }
        }

        const newDMRoom = new DbDmRoom();
        newDMRoom.RoomId = event.room_id;
        newDMRoom.UserId = event.sender;
        newDMRoom.DiscordId = discordUserId;
        await newDMRoom.Insert(this.store);

        //TODO: Start client if not active.
    }

    public async OnMatrixMessage(event): Promise<void> {
        const DMRoom = await this.store.Get(DbDmRoom, {room_id: event.room_id});
        if (!DMRoom.Result) {
            return;
        }
    }

    private async onDiscordMessage(): Promise<void> {

    }

    private async CheckInvite(event): Promise<InviteResult> {
        const MAX_MEMBERS_FOR_DM = 2;
        const userIntent = this.bridge.getIntent(event.state_key);
        /* We still fetch state so we can send the correct error message, even though we could bomb out early
           if we disabled DMs.
         */
        const state = await userIntent.roomState(event.room_id);
        const memberEvents = state.filter((stateEvent) => stateEvent.type === "m.room.member").length;

        if (memberEvents > MAX_MEMBERS_FOR_DM) {
            return {valid: false, message: NOT_DM_ROOM};
        }

        if (!this.config.enableDMs) {
            return {valid: false, message: NOT_ENABLED_ERROR};
        }

        if (!this.clientFactory.UserIsPuppeted(event.sender)) {
            return {valid: false, message: NOT_PUPPETED};
        }

        return {valid: true, message: null};
    }
}