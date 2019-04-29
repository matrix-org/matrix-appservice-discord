import { WorkerBase, WorkerCom } from "./WorkerBase";
import { isMainThread, workerData, Worker, parentPort } from "worker_threads";
import { PresenceHandler, IPresenceHandler } from "../presencehandler";
import { GuildMember } from "discord.js";
import { MIN_PRESENCE_UPDATE_DELAY } from "../bot";

/**
 * This class is used for communicating to the worker thread from the main thread.
 */
export class PresenceWorkerCom extends WorkerCom implements IPresenceHandler {

    Start(intervalTime: number): Promise<void> {
        throw new Error("Method not implemented.");
    }
    Stop(): void {
        throw new Error("Method not implemented.");
    }
    EnqueueUser(user: import("discord.js").User): void {
        throw new Error("Method not implemented.");
    }
    DequeueUser(user: import("discord.js").User): void {
        throw new Error("Method not implemented.");
    }
    ProcessUser(user: import("discord.js").User): Promise<boolean> {
        throw new Error("Method not implemented.");
    }

    constructor(worker: Worker) {
        super(worker);
    }
}

export class PresenceWorker extends WorkerBase {
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
        new PresenceWorker(workerData).run().catch((ex) => {
            parentPort!.postMessage({type: "close", reason: "error", error: ex});
            parentPort!.close();
        });
    } catch (ex) {
        parentPort!.postMessage({type: "close", reason: "error", error: ex});
        parentPort!.close();
    }
}