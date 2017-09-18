import * as Discord from "discord.js";
import * as log from "npmlog";
import { DiscordBot } from "./bot";

export class PresenceHandlerStatus {
    /* One of: ["online", "offline", "unavailable"] */
    public Presence: string;
    public StatusMsg: string;
    public ShouldDrop: boolean = false;
}

export class PresenceHandler {
    private readonly bot: DiscordBot;
    private presenceQueue: Discord.GuildMember[];
    private interval: number;
    constructor (bot: DiscordBot) {
        this.bot = bot;
        this.presenceQueue = new Array();
    }

    get QueueCount (): number {
        return this.presenceQueue.length;
    }

    public Start(intervalTime: number) {
        if (this.interval) {
            log.info("PresenceHandler", "Restarting presence handler...");
            this.Stop();
        }
        log.info("PresenceHandler", `Starting presence handler with new interval ${intervalTime}ms`);
        this.interval = setInterval(this.processIntervalThread.bind(this), intervalTime);
    }

    public Stop() {
        if (!this.interval) {
            log.info("PresenceHandler", "Can not stop interval, not running.");
        }
        log.info("PresenceHandler", "Stopping presence handler");
        clearInterval(this.interval);
        this.interval = null;
    }

    public EnqueueMember(member: Discord.GuildMember) {
        if (!this.presenceQueue.includes(member)) {
            log.info("PresenceHandler", `Adding ${member.id} (${member.user.username}) to the presence queue`);
            this.presenceQueue.push(member);
        }
    }

    public DequeueMember(member: Discord.GuildMember) {
        const index = this.presenceQueue.findIndex((item) => {
            return member === item;
        });
        if (index !== -1) {
            this.presenceQueue.splice(index, 1);
        } else {
            log.warn(
                "PresenceHandler",
                `Tried to remove ${member.id} from the presence queue but it could not be found`,
            );
        }
    }

    public ProcessMember(member: Discord.GuildMember): boolean {
        const status = this.getUserPresence(member.presence);
        this.setMatrixPresence(member, status);
        return status.ShouldDrop;
    }

    private processIntervalThread() {
        const member = this.presenceQueue.shift();
        if (member) {
            if (!this.ProcessMember(member)) {
                this.presenceQueue.push(member);
            } else {
                log.info("PresenceHandler", `Dropping ${member.id} from the presence queue.`);
            }
        }
    }

    private getUserPresence(presence: Discord.Presence): PresenceHandlerStatus {
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

    private setMatrixPresence(guildMember: Discord.GuildMember, status: PresenceHandlerStatus) {
        const intent = this.bot.GetIntentFromDiscordMember(guildMember);
        const statusObj: any = {presence: status.Presence};
        if (status.StatusMsg) {
            statusObj.status_msg = status.StatusMsg;
        }
        intent.getClient().setPresence(statusObj).catch((ex) => {
            log.warn("PresenceHandler", `Could not update Matrix presence for ${guildMember.id}`);
        });
    }
}
