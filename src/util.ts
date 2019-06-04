/*
Copyright 2018, 2019 matrix-appservice-discord

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import * as http from "http";
import * as https from "https";
import { Intent } from "matrix-appservice-bridge";
import { Buffer } from "buffer";
import * as mime from "mime";
import { Permissions } from "discord.js";
import { DiscordBridgeConfig } from "./config";
import { Client as MatrixClient } from "matrix-js-sdk";
import { IMatrixEvent } from "./matrixtypes";

const HTTP_OK = 200;

import { Log } from "./log";
const log = new Log("Util");

type PERMISSIONTYPES = any | any[]; // tslint:disable-line no-any

export interface ICommandAction {
    description?: string;
    help?: string;
    params: string[];
    permission?: PERMISSIONTYPES;
    run(params: any): Promise<any>; // tslint:disable-line no-any
}

export interface ICommandActions {
    [index: string]: ICommandAction;
}

export interface ICommandParameter {
    description?: string;
    get?(param: string): Promise<any>; // tslint:disable-line no-any
}

export interface ICommandParameters {
    [index: string]: ICommandParameter;
}

export type CommandPermissonCheck = (permission: PERMISSIONTYPES) => Promise<boolean | string>;

export interface IPatternMap {
    [index: string]: string;
}

export class Util {
    /**
     * downloadFile - This function will take a URL and store the resulting data into
     * a buffer.
     */
    public static async DownloadFile(url: string): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            let ht;
            if (url.startsWith("https")) {
                ht = https;
            } else {
                ht = http;
            }
            const req = ht.get((url), (res) => {
                let buffer = Buffer.alloc(0);
                if (res.statusCode !== HTTP_OK) {
                    reject(`Non 200 status code (${res.statusCode})`);
                }

                res.on("data", (d) => {
                    buffer = Buffer.concat([buffer, d]);
                });

                res.on("end", () => {
                    resolve(buffer);
                });
            });
            req.on("error", (err) => {
                reject(`Failed to download. ${err.code}`);
            });
        }) as Promise<Buffer>;
    }
    /**
     * uploadContentFromUrl - Upload content from a given URL to the homeserver
     * and return a MXC URL.
     */
    public static async UploadContentFromUrl(url: string, intent: Intent, name: string | null): Promise<IUploadResult> {
        let contenttype;
        name = name || null;
        try {
            const bufferRet = (await (new Promise((resolve, reject) => {
                let ht;
                if (url.startsWith("https")) {
                    ht = https;
                } else {
                    ht = http;
                }
                const req = ht.get( url, (res) => {
                    let buffer = Buffer.alloc(0);

                    if (res.headers.hasOwnProperty("content-type")) {
                        contenttype = res.headers["content-type"];
                    } else {
                        log.verbose("No content-type given by server, guessing based on file name.");
                        contenttype = mime.lookup(url);
                    }

                    if (name === null) {
                        const names = url.split("/");
                        name = names[names.length - 1];
                    }

                    res.on("data", (d) => {
                        buffer = Buffer.concat([buffer, d]);
                    });

                    res.on("end", () => {
                        resolve(buffer);
                    });
                });
                req.on("error", (err) => {
                    reject(`Failed to download. ${err.code}`);
                });
            }))) as Buffer;
            const size = bufferRet.length;
            const contentUri = await intent.getClient().uploadContent(bufferRet, {
                name,
                onlyContentUri: true,
                rawResponse: false,
                type: contenttype,
            });
            log.verbose("Media uploaded to ", contentUri);
            return {
                mxcUrl: contentUri,
                size,
            };
        } catch (reason) {
            log.error("Failed to upload content:\n", reason);
            throw reason;
        }
    }

    /**
     * Gets a promise that will resolve after the given number of milliseconds
     * @param {number} duration The number of milliseconds to wait
     * @returns {Promise<any>} The promise
     */
    public static async DelayedPromise(duration: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            setTimeout(resolve, duration);
        });
    }

    public static GetBotLink(config: DiscordBridgeConfig): string {
        /* tslint:disable:no-bitwise */
        const perms = Permissions.FLAGS.READ_MESSAGES! |
            Permissions.FLAGS.SEND_MESSAGES! |
            Permissions.FLAGS.CHANGE_NICKNAME! |
            Permissions.FLAGS.CONNECT! |
            Permissions.FLAGS.SPEAK! |
            Permissions.FLAGS.EMBED_LINKS! |
            Permissions.FLAGS.ATTACH_FILES! |
            Permissions.FLAGS.READ_MESSAGE_HISTORY! |
            Permissions.FLAGS.MANAGE_WEBHOOKS! |
            Permissions.FLAGS.MANAGE_MESSAGES!;
        /* tslint:enable:no-bitwise */

        const clientId = config.auth.clientID;

        return `https://discordapp.com/api/oauth2/authorize?client_id=${clientId}&scope=bot&permissions=${perms}`;
    }

    public static async GetMxidFromName(intent: Intent, name: string, channelMxids: string[]) {
        if (name[0] === "@" && name.includes(":")) {
            return name;
        }
        const client = intent.getClient();
        const matrixUsers = {};
        let matches = 0;
        await Promise.all(channelMxids.map((chan) => {
            // we would use this.bridge.getBot().getJoinedMembers()
            // but we also want to be able to search through banned members
            // so we gotta roll our own thing
            return client._http.authedRequestWithPrefix(
                undefined,
                "GET",
                `/rooms/${encodeURIComponent(chan)}/members`,
                undefined,
                undefined,
                "/_matrix/client/r0",
            ).then((res) => {
                res.chunk.forEach((member) => {
                    if (member.membership !== "join" && member.membership !== "ban") {
                        return;
                    }
                    const mxid = member.state_key;
                    if (mxid.startsWith("@_discord_")) {
                        return;
                    }
                    let displayName = member.content.displayname;
                    if (!displayName && member.unsigned && member.unsigned.prev_content &&
                        member.unsigned.prev_content.displayname) {
                        displayName = member.unsigned.prev_content.displayname;
                    }
                    if (!displayName) {
                        displayName = mxid.substring(1, mxid.indexOf(":"));
                    }
                    if (name.toLowerCase() === displayName.toLowerCase() || name === mxid) {
                        matrixUsers[mxid] = displayName;
                        matches++;
                    }
                });
            });
        }));
        if (matches === 0) {
            throw Error(`No users matching ${name} found`);
        }
        if (matches > 1) {
            let errStr = "Multiple matching users found:\n";
            for (const mxid of Object.keys(matrixUsers)) {
                errStr += `${matrixUsers[mxid]} (\`${mxid}\`)\n`;
            }
            throw Error(errStr);
        }
        return Object.keys(matrixUsers)[0];
    }

    public static async HandleHelpCommand(
        prefix: string,
        actions: ICommandActions,
        parameters: ICommandParameters,
        args: string[],
        permissionCheck?: CommandPermissonCheck,
    ): Promise<string> {
        let reply = "";
        if (args[0]) {
            const actionKey = args[0];
            const action = actions[actionKey];
            if (!actions[actionKey]) {
                return `**ERROR:** unknown command! Try \`${prefix} help\` to see all commands`;
            }
            if (action.permission !== undefined && permissionCheck) {
                const permCheck = await permissionCheck(action.permission);
                if (typeof permCheck === "string") {
                    return `**ERROR:** ${permCheck}`;
                }
                if (!permCheck) {
                    return `**ERROR:** permission denied! Try \`${prefix} help\` to see all available commands`;
                }
            }
            reply += `\`${prefix} ${actionKey}`;
            for (const param of action.params) {
                reply += ` <${param}>`;
            }
            reply += `\`: ${action.description}\n`;
            if (action.help) {
                reply += action.help;
            }
            return reply;
        }
        reply += "Available Commands:\n";
        for (const actionKey of Object.keys(actions)) {
            const action = actions[actionKey];
            if (action.permission !== undefined && permissionCheck) {
                const permCheck = await permissionCheck(action.permission);
                if (typeof permCheck === "string" || !permCheck) {
                    continue;
                }
            }
            reply += ` - \`${prefix} ${actionKey}`;
            for (const param of action.params) {
                reply += ` <${param}>`;
            }
            reply += `\`: ${action.description}\n`;
        }
        reply += "\nParameters:\n";
        for (const parameterKey of Object.keys(parameters)) {
            const parameter = parameters[parameterKey];
            reply += ` - \`<${parameterKey}>\`: ${parameter.description}\n`;
        }
        return reply;
    }

    public static async ParseCommand(
        prefix: string,
        msg: string,
        actions: ICommandActions,
        parameters: ICommandParameters,
        permissionCheck?: CommandPermissonCheck,
    ): Promise<string> {
        const {command, args} = Util.MsgToArgs(msg, prefix);
        if (command === "help") {
            return await Util.HandleHelpCommand(prefix, actions, parameters, args, permissionCheck);
        }

        if (!actions[command]) {
            return `**ERROR:** unknown command. Try \`${prefix} help\` to see all commands`;
        }
        const action = actions[command];
        if (action.permission !== undefined && permissionCheck) {
            const permCheck = await permissionCheck(action.permission);
            if (typeof permCheck === "string") {
                return `**ERROR:** ${permCheck}`;
            }
            if (!permCheck) {
                return `**ERROR:** insufficiant permissions to use this command! ` +
                    `Try \`${prefix} help\` to see all available commands`;
            }
        }
        if (action.params.length === 1) {
            args[0] = args.join(" ");
        }
        try {
            const params = {};
            let i = 0;
            for (const param of action.params) {
                if (parameters[param].get !== undefined) {
                    params[param] = await parameters[param].get!(args[i]);
                } else {
                    params[param] = args[i];
                }
                i++;
            }

            const retStr = await action.run(params);
            return retStr;
        } catch (e) {
            log.error("Error processing command");
            log.error(e);
            return `**ERROR:** ${e.message}`;
        }
    }

    public static MsgToArgs(msg: string, prefix: string) {
        prefix += " ";
        let command = "help";
        let args: string[] = [];
        if (msg.length >= prefix.length) {
            const allArgs = msg.substring(prefix.length).split(" ");
            if (allArgs.length && allArgs[0] !== "") {
                command = allArgs[0];
                allArgs.splice(0, 1);
                args = allArgs;
            }
        }
        return {command, args};
    }

    public static async AsyncForEach(arr, callback) {
        for (let i = 0; i < arr.length; i++) {
            await callback(arr[i], i, arr);
        }
    }

    public static NumberToHTMLColor(color: number): string {
        const HEX_BASE = 16;
        const COLOR_MAX = 0xFFFFFF;
        if (color > COLOR_MAX) {
            color = COLOR_MAX;
        }
        if (color < 0) {
            color = 0;
        }
        const colorHex = color.toString(HEX_BASE);
        const pad = "#000000";
        const htmlColor = pad.substring(0, pad.length - colorHex.length) + colorHex;
        return htmlColor;
    }

    public static ApplyPatternString(str: string, patternMap: IPatternMap): string {
        for (const p of Object.keys(patternMap)) {
            str = str.replace(new RegExp(":" + p, "g"), patternMap[p]);
        }
        return str;
    }

    public static async CheckMatrixPermission(
        mxClient: MatrixClient,
        userId: string,
        roomId: string,
        defaultLevel: number,
        cat: string,
        subcat?: string,
    ) {
        const res: IMatrixEvent = await mxClient.getStateEvent(roomId, "m.room.power_levels");
        let requiredLevel = defaultLevel;
        if (res && (res[cat] || !subcat)) {
            if (subcat) {
                if (res[cat][subcat] !== undefined) {
                    requiredLevel = res[cat][subcat];
                }
            } else {
                if (res[cat] !== undefined) {
                    requiredLevel = res[cat];
                }
            }
        }

        let haveLevel = 0;
        if (res && res.users_default) {
            haveLevel = res.users_default;
        }
        if (res && res.users && res.users[userId] !== undefined) {
            haveLevel = res.users[userId];
        }
        return haveLevel >= requiredLevel;
    }
}

interface IUploadResult {
    mxcUrl: string;
    size: number;
}
