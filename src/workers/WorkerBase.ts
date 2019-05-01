import { isMainThread, parentPort, Worker } from "worker_threads";
import { PresenceWorkerCom } from "./PresenceWorker";
import { DiscordBridgeConfig } from "../config";
import { DiscordStore } from "../store";
import { DiscordClientFactory } from "../clientfactory";
import { Log } from "../log";
import { User } from "discord.js";
import { DiscordBot } from "../bot";
import { Bridge } from "matrix-appservice-bridge";
import { WorkerCom, IWorkerIntentAction, IWorkerResult } from "./WorkerCom";
import * as uuid from "uuid/v4";

const log = new Log("WorkerBase");

/**
 * A base class for workers run by the bridge.
 */
let supported = false;
try {
    const worker = require("worker_threads");
} catch {
    supported = false;
}

/**
 * Worker types that can be run.
 */
export type WorkerTypes = "presence";

export interface IWorkerConfiguration {
    config: any,
    registration: any,
};

export abstract class WorkerBase {
    private static workers: {[workerName: string]: WorkerCom} = {};
    protected config: DiscordBridgeConfig;
    protected registration: any;
    protected store: DiscordStore|null = null;
    protected clientFactory: DiscordClientFactory|null = null;
    
    protected get needsStore() : boolean {
        return false;
    }

    protected get needsClientFactory() : boolean {
        return false;
    }

    constructor(data: IWorkerConfiguration) {
        if (isMainThread) {
            throw new Error("Cannot create worker class on the main thread");
        }
        // There isa a bug in the type mappings which means that parentPort
        // can't be directly mapped.
        this.config = new DiscordBridgeConfig();
        this.config.ApplyConfig(data.config);
        this.registration = data.registration;

        if (this.needsStore) {
            this.store = new DiscordStore(this.config.database);
        }

        if (this.needsClientFactory) {
            if (!this.needsStore) {
                throw new Error("needsStore must be true if needsClientFactory is true");
            }
            this.clientFactory = new DiscordClientFactory(this.store!, this.config.auth);
        }

    }

    protected runIntentAction(user: string|User, func: string, args: any[] = [], useClient: boolean): Promise<any> {
        const msg = {
            "type": "intent_action",
            id: uuid(),
            function: func,
            args,
            matrixId: undefined,
            discordId: undefined,
            useClient,
        } as IWorkerIntentAction;
        if (typeof user === "string") {
            msg.matrixId = user;
        } else {
            msg.discordId = (user as User).id;
        }
        parentPort!.postMessage(msg);
        return new Promise((resolve, reject) => {
            let responseFunc;
            responseFunc = (response: IWorkerResult) => {
                if (response.id !== msg.id) { return; }
                if (response.error != null) {
                    reject(response.error);
                } else {
                    resolve(response.result);
                }
                parentPort!.removeListener("message", responseFunc);
            }
            parentPort!.on("message", responseFunc);
        });
    }
    /**
     * Are workers supported by the bridge.
     */
    public static get supported() : boolean {
        return supported;
    }

    public async run(): Promise<void> {
        if (this.store) {
            await this.store.init();
            if (this.clientFactory) {
                await this.clientFactory.init();
            }
        }
    }

    // MAIN THREAD CODE

    public static spawnWorker(name: string, bot: DiscordBot, bridge: Bridge, config: any, registration: any): WorkerCom {
        if (WorkerBase.workers[name]) {
            throw new Error("Worker exists, cannot spawn new worker.");
        }
        let com: WorkerCom;
        let worker: Worker;
        if (name == "presence") {
            worker = new Worker("./build/src/workers/PresenceWorker.js", {
                workerData: {
                    config,
                    registration,
                }
            }); // again, the typing seem to be lacking here :|.

            com = new PresenceWorkerCom(worker, bot, bridge);
            WorkerBase.workers[name] = com;
        } else {
            throw new Error("Worker type unsupported");
        }
        worker.on("online", () => {
            log.info(`Worker ${name} has come online`);
        });
        worker.on("message", (value) => {
            log.silly(`Worker ${name}: ${JSON.stringify(value)}`);
        });
        worker.on("exit", (exitCode) => {
            log.warn(`Worker ${name} has exited (${exitCode})`);
        });
        return com;
    }

    public static getWorker<T extends WorkerCom>(name: string): T {
        return WorkerBase.workers[name] as T;
    }
}