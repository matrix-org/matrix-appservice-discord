import * as http from "http";
import * as https from "https";
import { Intent } from "matrix-appservice-bridge";
import { Buffer } from "buffer";
import * as log from "npmlog";
import * as mime from "mime";

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
}

interface IUploadResult {
  mxcUrl: string;
  size: number;
}
