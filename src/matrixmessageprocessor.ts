import * as Discord from "discord.js";
import { IMatrixMessage } from "./matrixtypes";

export class MatrixMessageProcessor {
    public async FormatMessage(msg: IMatrixMessage, guild: Discord.Guild): Promise<string> {
        let reply = "";
        if (msg.formatted_body) {
            
        } else {
            reply = this.escapeDiscord(msg.body);
        }
        return reply;
    }

    private escapeDiscord(msg: string): string {
        const escapeChars = ["\\", "*", "_", "~", "`"];
        escapeChars.forEach((char) => {
            msg = msg.replace(new RegExp("\\"+char, "g"), "\\" + char);
        });
        return msg;
    }
}
