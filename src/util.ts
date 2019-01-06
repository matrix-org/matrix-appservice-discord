import * as http from "http";
import * as https from "https";
import { Intent } from "matrix-appservice-bridge";
import { Buffer } from "buffer";
import * as mime from "mime";
import { Permissions } from "discord.js";
import { DiscordBridgeConfig } from "./config";

const HTTP_OK = 200;

import { Log } from "./log";
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

    public static str2mxid(a: string): string {
        let buf = new Buffer(a);
        let encoded = '';
        for (let b of buf) {
            if (b == 0x5F) {
                // underscore
                encoded += '__';
            } else if ((b >= 0x61 && b <= 0x7A) || (b >= 0x30 && b <= 0x39)) {
                // [a-z0-9]
                encoded += String.fromCharCode(b);
            } else if (b >= 0x41 && b <= 0x5A) {
                encoded += '_' + String.fromCharCode(b + 0x20);
            } else if (b < 16) {
                encoded += '=0' + b.toString(16);
            } else {
                encoded += '=' + b.toString(16);
            }
        }
        return encoded;
    }

    public static mxid2str(b: string): string {
        let decoded = new Buffer(b.length);
        let j = 0;
        for (let i = 0; i < b.length; i++) {
            let char = b[i];
            if (char == '_') {
                i++;
                if (b[i] == '_') {
                    decoded[j] = 0x5F;
                } else {
                    decoded[j] = b[i].charCodeAt(0) - 0x20;
                }
            } else if (char == '=') {
                i++;
                decoded[j] = parseInt(b[i]+b[i+1], 16);
                i++;
            } else {
                decoded[j] = b[i].charCodeAt(0);
            }
            j++;
        }
        return decoded.toString('utf8', 0, j);
    }
}

interface IUploadResult {
    mxcUrl: string;
    size: number;
}
