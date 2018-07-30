import {User, Presence} from "discord.js";
import { DiscordBot } from "./bot";
import { Log } from "./log";
const log = new Log("PresenceHandler");

export class PresenceHandlerStatus {
    /* One of: ["online", "offline", "unavailable"] */
    public Presence: string;
    public StatusMsg: string;
    public ShouldDrop: boolean = false;
}

export class PresenceHandler {
    private readonly bot: DiscordBot;
    private presenceQueue: User[];
    private interval: number;
    constructor (bot: DiscordBot) {
        this.bot = bot;
        this.presenceQueue = [];
    }

    get QueueCount (): number {
        return this.presenceQueue.length;
    }

    public Start(intervalTime: number) {
        if (this.interval) {
            log.info("Restarting presence handler...");
            this.Stop();
        }
        log.info(`Starting presence handler with new interval ${intervalTime}ms`);
        this.interval = setInterval(this.processIntervalThread.bind(this), intervalTime);
    }

    public Stop() {
        if (!this.interval) {
            log.info("Can not stop interval, not running.");
        }
        log.info("Stopping presence handler");
        clearInterval(this.interval);
        this.interval = null;
    }

    public EnqueueUser(user: User) {
        if (user.id !== this.bot.GetBotId() && this.presenceQueue.find((u) => u.id === user.id) === undefined) {
            log.info(`Adding ${user.id} (${user.username}) to the presence queue`);
            this.presenceQueue.push(user);
        }
    }

    public DequeueUser(user: User) {
        const index = this.presenceQueue.findIndex((item) => {
            return user.id === item.id;
        });
        if (index !== -1) {
            this.presenceQueue.splice(index, 1);
        } else {
            log.warn(
                `Tried to remove ${user.id} from the presence queue but it could not be found`,
            );
        }
    }

    public ProcessUser(user: User): boolean {
        const status = this.getUserPresence(user.presence);
        this.setMatrixPresence(user, status);
        return status.ShouldDrop;
    }

    private processIntervalThread() {
        const user = this.presenceQueue.shift();
        if (user) {
            if (!this.ProcessUser(user)) {
                this.presenceQueue.push(user);
            } else {
                log.info(`Dropping ${user.id} from the presence queue.`);
            }
        }
    }

    private getUserPresence(presence: Presence): PresenceHandlerStatus {
        const status = new PresenceHandlerStatus();

        if (presence.game) {
            status.StatusMsg = `${presence.game.streaming ? "Streaming" : "Playing"} ${presence.game.name}`;
            if (presence.game.url) {
                status.StatusMsg += ` | ${presence.game.url}`;
            }
        }

        if (presence.status === "online") {
            status.Presence = "online";
        } else if (presence.status === "dnd") {
            status.Presence = "online";
            status.StatusMsg = status.StatusMsg ? "Do not disturb | " + status.StatusMsg : "Do not disturb";
        } else if (presence.status === "offline") {
            status.Presence = "offline";
            status.ShouldDrop = true; // Drop until we recieve an update.
        } else { // idle
            status.Presence = "unavailable";
        }
        return status;
    }

    private setMatrixPresence(user: User, status: PresenceHandlerStatus) {
        const intent = this.bot.GetIntentFromDiscordMember(user);
        const statusObj: any = {presence: status.Presence};
        if (status.StatusMsg) {
            statusObj.status_msg = status.StatusMsg;
        }
        intent.getClient().setPresence(statusObj).catch((ex) => {
            if (ex.errcode !== "M_FORBIDDEN") {
                log.warn(`Could not update Matrix presence for ${user.id}`);
                return;
            }
            return this.bot.UserSyncroniser.OnUpdateUser(user).catch((err) => {
                log.warn(`Could not register new Matrix user for ${user.id}`);
            });
        });
    }
}
