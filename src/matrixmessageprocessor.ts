import * as Discord from "discord.js";
import { IMatrixMessage } from "./matrixtypes";
import * as Parser from "node-html-parser";
import { Util } from "./util";

export class MatrixMessageProcessor {
    public async FormatMessage(msg: IMatrixMessage, guild: Discord.Guild): Promise<string> {
        let reply = "";
        if (msg.formatted_body) {
            // parser needs everything wrapped in html elements
            // so we wrap everything in <div> just to be sure stuff is wrapped
            // as <div> will be un-touched anyways
            const parsed = Parser.parse(`<div>${msg.formatted_body}</div>`, {
                lowerCaseTagName: true,
                pre: true,
            // tslint:disable-next-line no-any
            } as any);
            reply = await this.walkNode(parsed);
        } else {
            reply = this.escapeDiscord(msg.body);
        }
        return reply;
    }

    private escapeDiscord(msg: string): string {
        const escapeChars = ["\\", "*", "_", "~", "`"];
        escapeChars.forEach((char) => {
            msg = msg.replace(new RegExp("\\" + char, "g"), "\\" + char);
        });
        return msg;
    }

    private parsePreContent(node: Parser.HTMLElement): string {
        let text = node.text;
        const match = text.match(/^<code([^>]*)>/i);
        if (!match) {
            if (text[0] !== "\n") {
                text = "\n" + text;
            }
            return text;
        }
        // remove <code> opening-tag
        text = text.substr(match[0].length);
        // remove </code> closing tag
        text = text.replace(/<\/code>$/i, "");
        if (text[0] !== "\n") {
            text = "\n" + text;
        }
        const language = match[1].match(/language-(\w*)/i);
        if (language) {
            text = language[1] + text;
        }
        return text;
    }

    private async walkChildNodes(node: Parser.Node): Promise<string> {
        let reply = "";
        await Util.AsyncForEach(node.childNodes, async (child) => {
            reply += await this.walkNode(child);
        });
        return reply;
    }

    private async walkNode(node: Parser.Node): Promise<string> {
        if (node.nodeType === Parser.NodeType.TEXT_NODE) {
            return this.escapeDiscord((node as Parser.TextNode).text);
        } else if (node.nodeType === Parser.NodeType.ELEMENT_NODE) {
            let _node = node as Parser.HTMLElement;
            switch (_node.tagName) {
                case 'em':
                case 'i':
                    return `*${await this.walkChildNodes(_node)}*`;
                case 'strong':
                case 'b':
                    return `**${await this.walkChildNodes(_node)}**`;
                case 'u':
                    return `__${await this.walkChildNodes(_node)}__`;
                case 'del':
                    return `~~${await this.walkChildNodes(_node)}~~`;
                case 'code':
                    return `\`${this.escapeDiscord(_node.innerHTML)}\``;
                case 'pre':
                    return `\n\`\`\`${this.parsePreContent(_node)}\`\`\`\n`;
                default:
                    return await this.walkChildNodes(_node);
            }
        }
        return "";
    }
}
