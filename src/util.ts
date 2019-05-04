/*
Copyright 2018 matrix-appservice-discord

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
import { Buffer } from "buffer";
import { Permissions } from "discord.js";
import { DiscordBridgeConfig } from "./config";

const HTTP_OK = 200;

import { Log } from "./log";
import { Intent } from "matrix-bot-sdk";
const log = new Log("Util");

export interface ICommandAction {
    params: string[];
    description?: string;
    permission?: string;
    run(params: any): Promise<any>; // tslint:disable-line no-any
}

export interface ICommandActions {
    [index: string]: ICommandAction;
}

export interface ICommandParameter {
    description?: string;
    get(param: string): Promise<any>; // tslint:disable-line no-any
}

export interface ICommandParameters {
    [index: string]: ICommandParameter;
}

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
        const client = intent.underlyingClient;
        await intent.ensureRegistered();
        const matrixUsers = {};
        let matches = 0;
        await Promise.all(channelMxids.map( async (chan) => {
            (await client.getRoomMembers(chan)).forEach((member) => {
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

    public static async ParseCommand(action: ICommandAction, parameters: ICommandParameters, args: string[]) {
        if (action.params.length === 1) {
            args[0] = args.join(" ");
        }
        const params = {};
        let i = 0;
        for (const param of action.params) {
            params[param] = await parameters[param].get(args[i]);
            i++;
        }

        const retStr = await action.run(params);
        return retStr;
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

    public static GetUrlFromMxc(mxc: string, homeserverUrl: string, width: number = 0, height: number = 0, method: "crop"|"scale" = "crop"): string {
        const part = mxc.substr("mxc://".length);
        if (width || height) {
            let u = `${homeserverUrl}/_matrix/media/r0/thumbnail/${part}?method=${method}`;
            if (width) {
                u += `&width=${width}`;
            }
            if (height) {
                u += `&height=${height}`;
            }
            return u;
        }
        return `${homeserverUrl}/_matrix/media/r0/download/${part}`;
    }

    public static ParseMxid(unescapedMxid: string, escape: boolean = true): {mxid: string, localpart: string, domain: string} {
        const parts = unescapedMxid.substr(1).split(":");
        const domain = parts[1];
        let localpart = parts[0];
        if (escape) {
            const badChars = new Set(localpart.replace(/([a-z0-9]|-|\.|=|_)+/g, ""));
            badChars.forEach((c) => {
                const hex = c.charCodeAt(0).toString(16).toLowerCase();
                localpart = localpart.replace(
                    new RegExp(`\\${c}`, "g"),
                    `=${hex}`
                );
            });
        }
        return {
            mxid: `@${localpart}:${domain}`,
            localpart,
            domain
        }
    }
}