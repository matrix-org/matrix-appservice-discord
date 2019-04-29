import { isMainThread, parentPort, Worker } from "worker_threads";
import { PresenceWorkerCom } from "./PresenceWorker";
import { DiscordBridgeConfig } from "../config";
import { DiscordStore } from "../store";
import { DiscordClientFactory } from "../clientfactory";
import { worker } from "cluster";
import { Log } from "../log";
import { User } from "discord.js";
import { DiscordBot } from "../bot";
import { Bridge } from "matrix-appservice-bridge";

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

export abstract class WorkerCom {
    constructor(protected worker: Worker, private bot: DiscordBot, private bridge: Bridge) {
        worker.on("message", this.onMessage.bind(this));
        worker.on("error", this.onError.bind(this));
    }

    protected onMessage(value: any) {
        if (value.type === "close") {
            log.warn(`Worker is closing: ${value.reason} ${value.error}`);
        } else if (value.type === "intentAction") {
            let intent;
            if (value.matrixId) {
                intent = this.bridge.getIntent(value.matrixId);
            } else if (value.discordId) {
                intent = this.bridge.getIntent(value.matrixId);
            }
        }
    }

    protected onError(exitCode: number) {

    }
}

export abstract class WorkerBase {
    private static workers: {[workerName: string]: WorkerCom} = {};
    private messagePort: MessagePort;
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
        this.messagePort = (parentPort as unknown as MessagePort);
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

    protected runIntentAction(user: string|User, func: string, args: any[]) {
        const msg = {
            "type": "intentAction",
            func,
            args,
            matrixId: "",
            discordId: "",
        }
        if (typeof user === "string") {
            msg.matrixId = user;
        } else {
            msg.discordId = (user as User).id;
        }
        this.messagePort.postMessage({
            "type": "intentAction",
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

    public static spawnWorker(name: string, bot: DiscordBot, bridge: Bridge, config: any, registration: any): WorkerCom {
        if (WorkerBase.workers[name]) {
            throw new Error("Worker exists, cannot spawn new worker.");
        }
        let com: WorkerCom;
        if (name == "presence") {
            const w = new Worker("./build/src/workers/PresenceWorker.js", {
                workerData: {
                    config,
                    registration,
                }
            }); // again, the typing seem to be lacking here :|.
            w.on("online", () => {
                log.info(`Worker ${name} has come online`);
            });
            w.on("message", (value) => {
                log.silly(`Worker ${name}: ${JSON.stringify(value)}`);
            });
            w.on("exit", (exitCode) => {
                log.warn(`Worker ${name} has exited (${exitCode})`);
            });
            com = new PresenceWorkerCom(w, bot, bridge);
            WorkerBase.workers[name] = com;
        } else {
            throw new Error("Worker type unsupported");
        }
        return com;
    }

    public static getWorker<T extends WorkerCom>(name: string): T {
        return WorkerBase.workers[name] as T;
    }
}