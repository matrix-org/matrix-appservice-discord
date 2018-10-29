import * as http from "http";
import * as https from "https";
import { Intent } from "matrix-appservice-bridge";
import { Buffer } from "buffer";
import * as mime from "mime";
import { Permissions } from "discord.js";

const HTTP_OK = 200;

import { Log } from "./log";
const log = new Log("Util");

export interface ICommandAction {
    params: string[];
    description?: string;
    permission?: string;
    run(params: any): Promise<any>;
}

export interface ICommandActions {
    [index: string]: ICommandAction;
}

export interface ICommandParameter {
    description?: string;
    get(param: string): Promise<any>;
}

export interface ICommandParameters {
    [index: string]: ICommandParameter;
}

export class Util {
    /**
     * downloadFile - This function will take a URL and store the resulting data into
     * a buffer.
     */
    public static DownloadFile(url: string): Promise<Buffer> {
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
        });
    }
    /**
     * uploadContentFromUrl - Upload content from a given URL to the homeserver
     * and return a MXC URL.
     */
    public static UploadContentFromUrl(url: string, intent: Intent, name: string): Promise<IUploadResult> {
        let contenttype;
        let size;
        name = name || null;
        return new Promise((resolve, reject) => {
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
        }).then((buffer: Buffer) => {
            size = buffer.length;
            return intent.getClient().uploadContent(buffer, {
                name,
                onlyContentUri: true,
                rawResponse: false,
                type: contenttype,
            });
        }).then((contentUri) => {
            log.verbose("Media uploaded to ", contentUri);
            return {
                mxcUrl: contentUri,
                size,
            };
        }).catch((reason) => {
            log.error("Failed to upload content:\n", reason);
            throw reason;
        });
    }

    /**
     * Gets a promise that will resolve after the given number of milliseconds
     * @param {number} duration The number of milliseconds to wait
     * @returns {Promise<any>} The promise
     */
    public static DelayedPromise(duration: number): Promise<any> {
        return new Promise<any>((resolve, reject) => {
            setTimeout(resolve, duration);
        });
    }

    public static GetBotLink(config: any): string {
        /* tslint:disable:no-bitwise */
        const perms = Permissions.FLAGS.READ_MESSAGES |
            Permissions.FLAGS.SEND_MESSAGES |
            Permissions.FLAGS.CHANGE_NICKNAME |
            Permissions.FLAGS.CONNECT |
            Permissions.FLAGS.SPEAK |
            Permissions.FLAGS.EMBED_LINKS |
            Permissions.FLAGS.ATTACH_FILES |
            Permissions.FLAGS.READ_MESSAGE_HISTORY |
            Permissions.FLAGS.MANAGE_WEBHOOKS |
            Permissions.FLAGS.MANAGE_MESSAGES;
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
                "/rooms/" + encodeURIComponent(chan) + "/members",
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
        let args = [];
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

    public static GetReplyFromReplyBody(body: string) {
        const lines = body.split("\n");
        while (lines[0].startsWith("> ") || lines[0].trim().length === 0) {
            lines.splice(0, 1);
            if (lines.length === 0) {
                return "";
            }
        }
        return lines.join("\n").trim();
    }

    public static async AsyncForEach(arr, callback) {
        for (let i = 0; i < arr.length; i++) {
            await callback(arr[i], i, arr);
        }
    }
}

interface IUploadResult {
    mxcUrl: string;
    size: number;
}
