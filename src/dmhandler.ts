import {DiscordBridgeConfig} from "./config";
import {DiscordClientFactory} from "./clientfactory";
import {
    Bridge,
} from "matrix-appservice-bridge";
import * as log from "npmlog";
import {DiscordStore} from "./store";
import {DbDmRoom} from "./db/dbdatadmroom";
import { Message, Client, User, DMChannel } from "discord.js";
import { DMRoom } from "./dmroom";
import { MessageProcessor } from "./messageprocessor";
import { MatrixEventProcessor } from "./matrixeventprocessor";

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
    private dmRooms: DMRoom[];
    private discordToUserIdMap: Map<string,string>;
    private messageProcessor: MessageProcessor;
    private matrixEventProcessor: MatrixEventProcessor;
    constructor (
        private config: DiscordBridgeConfig,
        private bridge: Bridge,
        private clientFactory: DiscordClientFactory,
        private store: DiscordStore,
        ) {
        this.dmRooms = [];
        this.messageProcessor = new MessageProcessor({
            domain: bridge.opts.domain,
            bot: null // No emoji support.
        });
        this.matrixEventProcessor = new MatrixEventProcessor({
            bridge: bridge,
            config: config
        });
        this.discordToUserIdMap = new Map();
    }

    get MessageProcessor() {
        return this.messageProcessor;
    }

    get EventProcessor() {
        return this.matrixEventProcessor;
    }

    get ClientFactory() {
        return this.clientFactory;
    }

    public async StartPuppetedClients() {
        log.info("DMHandler", "Starting puppeted clients to hook into DMs.");
        const users = await this.store.get_all_user_discord_ids();
        log.info("DMHandler", `Starting ${users.length} clients`);
        // TODO: How do we recover if the client dies for some reason?
        await Promise.all(users.map(({discord_id, user_id}) => {
            return this.clientFactory.getClient(user_id).then((client) => {
                this.discordToUserIdMap.set(client.user.id, user_id);
                client.on("message", (msg) => { this.onDiscordMessage(msg); });
            }).catch((e) => {
                log.error("DMHandler", "Failed to start client", e);
            });
        }));
    }

    public async HandleInvite(event: any) {
        // if (!this.bridge.getBot()._isRemoteUser(event.state_key)) {
        //     log.verbose("DMHandler", `Ignoring invite for ${event.room_id} (${event.sender} invited ${event.state_key})`);
        //     return;
        // }
        // log.info("DMHandler", `Got invite for ${event.room_id} (${event.sender} invited ${event.state_key})`);

        // let discordUserId = null;
        // try {
        //     const discordUsers = await this.bridge.getUserStore().getRemoteUsersFromMatrixId(
        //         event.state_key.substr("@".length),
        //     );
        //     if ( discordUsers.length === 0) {
        //         log.warn("DMHandler", "Got an invite for a virtual user the bridge doesn't know about!");
        //         return;
        //     }
        //     discordUserId = discordUsers[0].getId();
        // } catch (e) {
        //     log.warn("DMHandler", "There was an error trying to fetch a remote user from the store!", e);
        //     return;
        // }

        // const result = await this.CheckInvite(event);
        // if (result.valid === false) {
        //     const userIntent = this.bridge.getIntent(event.state_key);
        //     try {
        //         await userIntent.sendMessage(event.room_id, {
        //             msgtype: "m.notice",
        //             body: result.message,
        //         });
        //     } catch (e) {
        //         // Uh..we can't send a message? Oh well, leave anyway.
        //     }
        //     return userIntent.leave(event.room_id);
        // }

        // const existingDMRoom = new DbDmRoom();
        // await existingDMRoom.RunQuery(this.store, {user_id: event.sender, discord_id: discordUserId});
        // if (existingDMRoom.Result === true) {
        //     log.info("DMHandler", "User already has a DM room with this user, dropping the old one.");
        //     const userIntent = this.bridge.getIntent(event.state_key);
        //     await existingDMRoom.Delete(this.store);
        //     try {
        //         await userIntent.kick(existingDMRoom.RoomId, event.state_key, "New DM Room created.");
        //     } catch (e) {
        //         log.warn("DMHandler", "Failed to kick self from old DM room.", e);
        //     }
        // }

        // const newDMRoom = new DbDmRoom();
        // newDMRoom.RoomId = event.room_id;
        // await newDMRoom.Insert(this.store);

        //TODO: Start client if not active.
    }

    public async OnMatrixMessage(event): Promise<void> {
        log.verbose("DMHandler", `Got DM message from ${event.room_id}`);
        try {
            const dmRoom = await this.GetDMRoomByRoomId(event);
            dmRoom.OnMatrixEvent(event);
        } catch(e) {
            log.error("DMHandler", `"Failed to get DM room, dropping message! ${event.room_id}`, e);
        }
    }

    public GetIntentForUser(user?: User): any {
        return this.bridge.getIntentFromLocalpart(`_discord_${user.id}`);
    }

    private async onDiscordMessage(msg: Message): Promise<void> {
        if (msg.channel.type !== "dm") {
            return; // We currently only support DMs.
        }
        log.verbose("DMHandler", `Got DM message from ${msg.channel.id}`);
        try {
            const dmRoom = await this.GetDMRoom(msg);
            dmRoom.OnDiscordMessage(msg);
        } catch(e) {
            log.error("DMHandler", `"Failed to get DM room, dropping message! ${msg.id}`, e);
        }
    }

    private async GetDMRoom(msg: Message): Promise<DMRoom> {
        // Check if we have a hydrated one ready for use?
        let room = this.dmRooms.find(
            (dmRoom) => dmRoom.DiscordChannelId === msg.channel.id
        );
        if (room === undefined) {
            log.info("DMHandler", `DmRoom ${msg.channel.id} not in memory, trying DB`);
            // Try to fetch one from the DB.
            let dbRoom = await this.store.Get(DbDmRoom,{
                chan_id: msg.channel.id
            });

            if (!dbRoom.Result) {
                log.info("DMHandler", `DmRoom ${msg.channel.id} not DB, creating new room!`);
                // We need to create a room!
                dbRoom = new DbDmRoom();
                dbRoom.ChannelId = msg.channel.id;
                let inviter: User = null;
                if (msg.channel.type === "dm") {
                    inviter = (<DMChannel>msg.channel).recipient;
                } else {
                    inviter = msg.author;
                }
                dbRoom.RoomId = await this.CreateMatrixRoomForDM(inviter, [
                    `@_discord_${msg.client.user.id}:${this.bridge.opts.domain}`,
                    this.discordToUserIdMap.get(msg.client.user.id),
                ]);
                log.info("DMHandler", `DmRoom ${msg.channel.id} is linked to ${dbRoom.RoomId}`);
                try {
                    await this.store.Insert(dbRoom);
                } catch (e) {
                    log.error("DMHandler", "Failed to insert DM room into database!", e);
                }
            }
            room = new DMRoom(dbRoom, this);
            this.dmRooms.push(room);
        }
        return room;
    }

    private async GetDMRoomByRoomId(event: any) {
        // Check if we have a hydrated one ready for use?
        let room = this.dmRooms.find(
            (dmRoom) => dmRoom.RoomId === event.room_id
        );
        if (room !== undefined) {
            return room;
        }
        log.info("DMHandler", `DmRoom ${event.room_id} not in memory, trying DB`);
        // Try to fetch one from the DB.
        let dbRoom = await this.store.Get(DbDmRoom,{
            room_id: event.room_id
        });
        if (dbRoom.Result) {
            room = new DMRoom(dbRoom, this);
            this.dmRooms.push(room);
            return room;
        }
        throw new Error("DM room not found!");
    }

    private async CheckInvite(event): Promise<InviteResult> {
        // const MAX_MEMBERS_FOR_DM = 2;
        // const userIntent = this.bridge.getIntent(event.state_key);
        // /* We still fetch state so we can send the correct error message, even though we could bomb out early
        //    if we disabled DMs.
        //  */
        // const state = await userIntent.roomState(event.room_id);
        // const memberEvents = state.filter((stateEvent) => stateEvent.type === "m.room.member").length;

        // if (memberEvents > MAX_MEMBERS_FOR_DM) {
        //     return {valid: false, message: NOT_DM_ROOM};
        // }

        // if (!this.config.enableDMs) {
        //     return {valid: false, message: NOT_ENABLED_ERROR};
        // }

        // if (!this.clientFactory.UserIsPuppeted(event.sender)) {
        //     return {valid: false, message: NOT_PUPPETED};
        // }

        return {valid: true, message: null};
    }

    private async CreateMatrixRoomForDM(author: User, recipients: string[]): Promise<string> {
        //BAD HALF-SHOT COPYING CODE TO AVOID DEPENDENCIES
        const intent = this.GetIntentForUser(author);
        return intent.createRoom( {
            createAsClient: true,
            options: {
                preset: "trusted_private_chat",
                is_direct: true,
                visibility: "private",
                invite: recipients,
            }
        }).then((res) => {
            return res.room_id;
        }).catch((e) => {
            log.error("DMHandler", `createRoom failed`, e);
            throw new Error("Failed to create DM room");
        });
    }
}