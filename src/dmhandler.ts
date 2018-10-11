import {DiscordBridgeConfig} from "./config";
import {DiscordClientFactory} from "./clientfactory";
import {
    Bridge,
} from "matrix-appservice-bridge";
import {DiscordStore} from "./store";
import {DbDmRoom} from "./db/dbdatadmroom";
import { Message, Client, User, DMChannel, Channel, GroupDMChannel, Util } from "discord.js";
import { DMRoom } from "./dmroom";
import { MessageProcessor } from "./messageprocessor";
import { MatrixEventProcessor } from "./matrixeventprocessor";
import { Log } from "./log";
import { UserSyncroniser } from "./usersyncroniser";

const log = new Log("DMHandler");

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
/**
 * Handler class that forwards memberstate and messages between Matrix and Discord DMs.
 * This class does not handle direct messaging rules or message formatting which
 * should be handled in DMRoom.
 */
export class DMHandler {
    private dmRooms: DMRoom[];
    private discordToUserIdMap: Map<string, string>;
    private messageProcessor: MessageProcessor;
    private matrixEventProcessor: MatrixEventProcessor;
    constructor (
        private config: DiscordBridgeConfig,
        private bridge: Bridge,
        private clientFactory: DiscordClientFactory,
        private store: DiscordStore,
        private userSync: UserSyncroniser,
        ) {
        this.dmRooms = [];
        this.messageProcessor = new MessageProcessor({
            domain: bridge.opts.domain,
            bot: null, // No emoji support.
        });
        this.matrixEventProcessor = new MatrixEventProcessor({
            bridge,
            config,
        });
        this.discordToUserIdMap = new Map();
    }

    /* A selection of processors and factories useful to DMRoom */

    get MessageProcessor() {
        return this.messageProcessor;
    }

    get EventProcessor() {
        return this.matrixEventProcessor;
    }

    get ClientFactory() {
        return this.clientFactory;
    }

    /**
     * Start all clients from accounts we can puppet, and listen for DM related events.
     * This uses clientFactory so any clients that are already started will be retrived instead.
     */
    public async StartPuppetedClients() {
        log.info("Starting puppeted clients to hook into DMs.");
        const users = await this.store.get_all_user_discord_ids();
        log.info(`Starting ${users.length} clients`);
        // TODO: How do we recover if the client dies for some reason?
        await Promise.all(users.map(({discord_id, user_id}) => {
            return this.clientFactory.getClient(user_id).then((client) => {
                this.discordToUserIdMap.set(client.user.id, user_id);
                client.on("message", (msg) => { this.onDiscordMessage(msg).catch((err) => {
                    log.error("Got error on message:", err);
                }); });
                client.on("typingStart", (channel, user) => { this.onDiscordTyping(channel, user, true); } );
                client.on("typingStop", (channel, user) => { this.onDiscordTyping(channel, user, false); } );
            }).catch((e) => {
                log.error("Failed to start client", e);
            });
        }));
    }

    public async HandleInvite(event: any) {
        // if (!this.bridge.getBot()._isRemoteUser(event.state_key)) {
        //     log.verbose(`Ignoring invite for ${event.room_id} (${event.sender} invited ${event.state_key})`);
        //     return;
        // }
        // log.info(`Got invite for ${event.room_id} (${event.sender} invited ${event.state_key})`);

        // let discordUserId = null;
        // try {
        //     const discordUsers = await this.bridge.getUserStore().getRemoteUsersFromMatrixId(
        //         event.state_key.substr("@".length),
        //     );
        //     if ( discordUsers.length === 0) {
        //         log.warn("Got an invite for a virtual user the bridge doesn't know about!");
        //         return;
        //     }
        //     discordUserId = discordUsers[0].getId();
        // } catch (e) {
        //     log.warn("There was an error trying to fetch a remote user from the store!", e);
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
        //     log.info("User already has a DM room with this user, dropping the old one.");
        //     const userIntent = this.bridge.getIntent(event.state_key);
        //     await existingDMRoom.Delete(this.store);
        //     try {
        //         await userIntent.kick(existingDMRoom.RoomId, event.state_key, "New DM Room created.");
        //     } catch (e) {
        //         log.warn("Failed to kick self from old DM room.", e);
        //     }
        // }

        // const newDMRoom = new DbDmRoom();
        // newDMRoom.RoomId = event.room_id;
        // await newDMRoom.Insert(this.store);
    }

    /**
     * An event that should be forwarded to a viable DMRoom. If a DM room doesn't exist
     * then one should be created locally and on the discord side.
     * @param event A matrix event
     */
    public async OnMatrixMessage(event): Promise<void> {
        log.verbose(`Got DM message from ${event.room_id}`);
        try {
            const dmRoom = await this.GetDMRoomByRoomId(event);
            dmRoom.OnMatrixEvent(event);
        } catch (e) {
            log.error(`"Failed to get DM room, dropping message! ${event.room_id}`, e);
        }
    }

    public GetMatrixIdForUser(user: User): any {
        // TODO: We should find out what the prefix actually is?
        return `@_discord_${user.id}:${this.bridge.opts.domain}`;
    }

    /**
     * Create a virtual user's intent based off a Discord user.
     * @param user A discord user
     */
    public GetIntentForUser(user: User): any {
        const userId = this.GetMatrixIdForUser(user);
        log.verbose(`Creating intent for ${userId}`);
        return this.bridge.getIntent(userId);
    }

    private async onDiscordMessage(msg: Message): Promise<void> {
        if (!["group", "dm"].includes(msg.channel.type)) {
            return;
        }

        try {
            await this.userSync.OnUpdateUser(msg.author);
        } catch (e) {
            log.warn(`Failed to sync ${msg.author.id}`);
        }

        if (msg.type === "RECIPIENT_ADD") {
            const dmRoom = await this.GetDMRoomByDiscordChannel(msg.channel);
            if (dmRoom) {
                const mentioned = msg.mentions.users.first();
                try {
                    await this.userSync.OnUpdateUser(mentioned);
                } catch (e) {
                    log.warn(`Failed to sync ${mentioned.id}`);
                }
                dmRoom.AddToRoom(msg.author, mentioned);
            }
            return;
        }

        if (msg.type === "RECIPIENT_REMOVE") {
            const dmRoom = await this.GetDMRoomByDiscordChannel(msg.channel);
            if (dmRoom) {
                const mentioned = msg.mentions.users.first();
                try {
                    await this.userSync.OnUpdateUser(mentioned);
                } catch (e) {
                    log.warn(`Failed to sync ${mentioned.id}`);
                }
                dmRoom.KickFromRoom(msg.author, msg.mentions.users.first());
            }
            return;
        }

        if (msg.type === "CHANNEL_NAME_CHANGE") {
            const dmRoom = await this.GetDMRoomByDiscordChannel(msg.channel);
            if (dmRoom) {
                dmRoom.UpdateName(msg.author, msg.content);
            }
            return;
        }

        if (msg.type === "CHANNEL_ICON_CHANGE") {
            const dmRoom = await this.GetDMRoomByDiscordChannel(msg.channel);
            if (dmRoom) {
                // TODO: For whatever reason, iconUrl has no types in this version.
                const chan = msg.channel as any;
                dmRoom.UpdateAvatar(msg.author, chan.iconUrl);
            }
            return;
        }

        if (msg.type !== "DEFAULT") {
            log.verbose(`Ignoring unknown message type ${msg.type}`);
            return;
        }

        log.verbose(`Got DM message from ${msg.channel.id}`);
        try {
            const dmRoom = await this.GetDMRoomByDiscordMessage(msg, true);
            dmRoom.OnDiscordMessage(msg);
        } catch (e) {
            log.error(`"Failed to get DM room, dropping message! ${msg.id}`, e);
        }
    }

    private async onDiscordTyping(channel: Channel, user: User, typing: boolean) {
        if (!["group", "dm"].includes(channel.type)) {
            return;
        }
        log.verbose(`Got typing from ${channel.id} ${user.id} ${user.username}`);
        const dmRoom = await this.GetDMRoomByDiscordChannel(channel);
        if (dmRoom !== null) {
            dmRoom.OnDiscordTyping(user, typing);
        }
    }

    private async GetDMRoomByDiscordChannel(chan: Channel): Promise<DMRoom|null> {
        let room = this.dmRooms.find(
            (dmRoom) => dmRoom.DiscordChannelId === chan.id,
        );
        if (room === undefined) {
            log.info(`DmRoom ${chan.id} not in memory, trying DB`);
            // Try to fetch one from the DB.
            const dbRoom = await this.store.Get(DbDmRoom, {
                chan_id: chan.id,
            });
            if (!dbRoom.Result) {
                return null;
            }
            room = new DMRoom(dbRoom, this);
            this.dmRooms.push(room);
        }
        return room;
    }

    private async GetDMRoomByDiscordMessage(msg: Message, create: Boolean = false): Promise<DMRoom> {
        // Check if we have a hydrated one ready for use?
        let room = await this.GetDMRoomByDiscordChannel(msg.channel);
        if (create && room === null) {
            log.info(`DmRoom ${msg.channel.id} not DB, creating new room!`);
            // We need to create a room!
            const dbRoom = new DbDmRoom();
            dbRoom.ChannelId = msg.channel.id;
            let inviter: User = null;
            const recipients = [
                this.discordToUserIdMap.get(msg.client.user.id),
            ]; // Always add the real matrix user.
            let name;
            if (msg.channel.type === "dm") {
                inviter = (<DMChannel> msg.channel).recipient;
                recipients.push(
                    `@_discord_${msg.client.user.id}:${this.bridge.opts.domain}`,
                );
            } else { // Group
                inviter = msg.client.user;
                (<GroupDMChannel> msg.channel).recipients.forEach((user) => {
                    recipients.push(
                        `@_discord_${user.id}:${this.bridge.opts.domain}`,
                    );
                });
                name = (<GroupDMChannel> msg.channel).name;
            }

            dbRoom.RoomId = await this.CreateMatrixRoomForDM(inviter, recipients, name);
            log.info(`DmRoom ${msg.channel.id} is linked to ${dbRoom.RoomId}`);
            try {
                await this.store.Insert(dbRoom);
            } catch (e) {
                log.error("Failed to insert DM room into database!", e);
            }
            room = new DMRoom(dbRoom, this);
            this.dmRooms.push(room);
        } else if (!create) {
            throw new Error("Room not found, not creating");
        }
        return room;
    }

    private async GetDMRoomByRoomId(event: any) {
        // Check if we have a hydrated one ready for use?
        let room = this.dmRooms.find(
            (dmRoom) => dmRoom.RoomId === event.room_id,
        );
        if (room !== undefined) {
            return room;
        }
        log.info(`DmRoom ${event.room_id} not in memory, trying DB`);
        // Try to fetch one from the DB.
        const dbRoom = await this.store.Get(DbDmRoom, {
            room_id: event.room_id,
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

    private async CreateMatrixRoomForDM(author: User, recipients: string[], name: string = undefined): Promise<string> {
        const intent = this.GetIntentForUser(author);
        const options = {
            preset: "trusted_private_chat",
            is_direct: true,
            visibility: "private",
            invite: recipients,
            name,
        };
        return intent.createRoom({
            createAsClient: true,
            options,
        }).then((res) => {
            return res.room_id;
        }).catch((e) => {
            log.error(`createRoom failed`, e);
            throw new Error("Failed to create DM room");
        });
    }
}
