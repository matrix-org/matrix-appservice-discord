import * as http from "http";
import * as https from "https";
import { Intent } from "matrix-appservice-bridge";
import { Buffer } from "buffer";
import * as log from "npmlog";
import * as mime from "mime";
import { Permissions } from "discord.js";

const HTTP_OK = 200;

export class Util {

  /**
   * downloadFile - This function will take a URL and store the resulting data into
   * a buffer.
   */
  public static DownloadFile (url: string): Promise<Buffer> {
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
  public static UploadContentFromUrl (url: string, intent: Intent, name: string): Promise<IUploadResult> {
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
          log.verbose("UploadContent", "No content-type given by server, guessing based on file name.");
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
        type: contenttype,
        onlyContentUri: true,
        rawResponse: false,
      });
    }).then((contentUri) => {
      log.verbose("UploadContent", "Media uploaded to %s", contentUri);
      return {
        mxcUrl: contentUri,
        size,
      };
    }).catch((reason) => {
      log.error("UploadContent", "Failed to upload content:\n%s", reason);
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
      Permissions.FLAGS.MANAGE_WEBHOOKS;
    /* tslint:enable:no-bitwise */

    const clientId = config.auth.clientID;

    return `https://discordapp.com/api/oauth2/authorize?client_id=${clientId}&scope=bot&permissions=${perms}`;
  }
}

interface IUploadResult {
  mxcUrl: string;
  size: number;
}
