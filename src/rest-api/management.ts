import { IRestApi, IApplication, IRequest, IResponse } from "./rest";
import { DiscordBot } from "../bot";
import { Channel } from "discord.js";
import { DiscordStore } from "../store";

interface IUnbridgeBody {
    discord_channel?: string;
    discord_guild?: string;
    matrix_room?: string;
}

interface IErrorResult {
    error: string;
}

export class ManagementApi implements IRestApi {

    constructor(private bot: DiscordBot, private store: DiscordStore) { }

    public bindEndpoints(app: IApplication) {
        // TODO: Handle auth.
        app.post("/management/unbridge", this.unbridgeRoom.bind(this));
    }

    public async unbridgeRoom(req: IRequest<IUnbridgeBody>, res: IResponse) {
        let channel: Channel;
        try {
            if (req.body.discord_channel && req.body.discord_guild) {
                const lookup = await this.bot.LookupRoom(req.body.discord_guild, req.body.discord_channel);
                channel = lookup.channel;
            } else if (req.body.matrix_room) {
                channel = await this.bot.GetChannelFromRoomId(req.body.matrix_room);
            } else {
                res.status(400).json({
                    error: "Need to specify discord_channel and discord_guild, matrix_room or both",
                } as IErrorResult);
                return;
            }
        } catch (ex) {
            res.status(404).json({
                error: "Channel not found",
            } as IErrorResult);
            return;
        }

        let roomIds: string[];

        if (!req.body.matrix_room) {
            const rooms = await this.store.roomStore.getEntriesByRemoteRoomData({
                discord_channel: req.body.discord_channel,
                discord_guild: req.body.discord_guild,
            });
            roomIds = rooms.map((room) => room.matrix!.roomId);
        } else {
            roomIds = [ req.body.matrix_room! ];
        }
        for (const roomId of roomIds) {
            await this.bot.ChannelSyncroniser.OnUnbridge(channel, roomId);
        }
        res.status(200).json({
            status: `Unbridged from ${roomIds.length} rooms`,
        });
    }
}
