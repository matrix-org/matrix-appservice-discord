import { WorkerBase, WorkerCom } from "./WorkerBase";
import { isMainThread, workerData, Worker, parentPort } from "worker_threads";
import { PresenceHandler, IPresenceHandler } from "../presencehandler";
import { GuildMember } from "discord.js";
import { MIN_PRESENCE_UPDATE_DELAY } from "../bot";

/**
 * This class is used for communicating to the worker thread from the main thread.
 */
export class DiscordAPIWorkerCom extends WorkerCom {
    constructor(worker: Worker) {
        super(worker);
    }
}
/**
 * The DiscordAPIWorker runs the discord.js code seperate from the main bridge.
 */
export class DiscordAPIWorker extends WorkerBase {
    protected needsClientFactory = true;
    protected needsStore = true;

    constructor(data: any) {
        super(data);
    }

    public async run(): Promise<void> {
        await super.run();
        const p = new PresenceHandler({} as any);
        await p.Start(this.config.bridge.presenceInterval);
        const bot = await this.clientFactory!.getClient();
        
        if (!this.config.bridge.presenceInterval) {
            this.config.bridge.presenceInterval = MIN_PRESENCE_UPDATE_DELAY;
        }
        bot.guilds.forEach((guild) => {
            guild.members.forEach((member) => {
                if (member.id !== bot.user.id) {
                    p.EnqueueUser(member.user);
                }
            });
        });

        await p.Start(
            Math.max(this.config.bridge.presenceInterval, MIN_PRESENCE_UPDATE_DELAY),
        );

        bot.on("presenceUpdate", (_, newMember: GuildMember) => {
            try {
                p.EnqueueUser(newMember.user);
            } catch (err) { /*log.warning("Exception thrown while handling \"presenceUpdate\" event", err);*/ }
        });
    }
}

if (!isMainThread) {
    try {
        new DiscordAPIWorker(workerData).run().catch((ex) => {
            parentPort!.postMessage({type: "close", reason: "error", error: ex});
            parentPort!.close();
        });
    } catch (ex) {
        parentPort!.postMessage({type: "close", reason: "error", error: ex});
        parentPort!.close();
    }
}