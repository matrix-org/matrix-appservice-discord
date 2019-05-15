// import { Worker } from "worker_threads";
// import { DiscordBot } from "../bot";
// import { Bridge } from "matrix-appservice-bridge";
// import { Log } from "../log";

// const log = new Log("WorkerCom");

// export interface IWorkerCmd {
//     type: string;
//     id: string;
// }

// export interface IWorkerResult extends IWorkerCmd {
//     type: "res";
//     error: any|null;
//     result: any|null;
// }

// export interface IWorkerCmdClose extends IWorkerCmd {
//     type: "close";
//     reason: string;
//     error: string|undefined;
// }

// export interface IWorkerIntentAction extends IWorkerCmd {
//     type: "intent_action";
//     useClient: boolean;
//     matrixId: string|undefined;
//     discordId: string|undefined;
//     function: string;
//     args: any[];
// }

// export abstract class WorkerCom {
//     constructor(protected worker: Worker, protected discordBot: DiscordBot|null = null, protected bridge: Bridge|null = null) {
//         worker.on("message", (value: IWorkerCmd) => {
//             this.onMessage(value).then((result) => {
//                 this.worker.postMessage({
//                     id: value.id,
//                     result,
//                     error: null,
//                 } as IWorkerResult);
//             }).catch((ex) => {
//                 this.worker.postMessage({
//                     id: value.id,
//                     result: null,
//                     error: ex,
//                 } as IWorkerResult);
//             })
//         });
//         worker.on("error", this.onError.bind(this));

//     }

//     protected async onMessage(value: IWorkerCmd) {
//         if (value.type === "close") {
//             const close = value as IWorkerCmdClose;
//             log.warn(`Worker is closing: ${close.reason} ${close.error}`);
//         } else if (value.type === "intent_action") {
//             const intentAction = value as IWorkerIntentAction;
//             let intent;
//             if (intentAction.matrixId) {
//                 intent = this.bridge!.getIntent(intentAction.matrixId);
//             } else if (intentAction.discordId) {
//                 intent = this.discordBot!.GetIntentFromDiscordMember(intentAction.discordId);
//             } else {
//                 log.warn("Tried to do an intent_action but no IDs were defined");
//                 return;
//             }
//             if (intentAction.useClient) {
//                 intent = intent.getClient();
//             }
//             const func: () => any = intent[intentAction.function];
//             if (!func) {
//                 log.warn(`Tried to do an intent_action but ${func} is not a valid function`);
//                 return;
//             }
//             return await func.call(intent, intentAction.args);
//         }
//     }

//     protected onError(exitCode: number) {

//     }
// }