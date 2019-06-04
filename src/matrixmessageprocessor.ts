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

import * as Discord from "discord.js";
import { IMatrixMessage, IMatrixEvent } from "./matrixtypes";
import * as Parser from "node-html-parser";
import { Util } from "./util";
import { DiscordBot } from "./bot";
import { Client as MatrixClient } from "matrix-js-sdk";

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 32;
const MATRIX_TO_LINK = "https://matrix.to/#/";
const DEFAULT_ROOM_NOTIFY_POWER_LEVEL = 50;

export interface IMatrixMessageProcessorParams {
    displayname?: string;
    mxClient?: MatrixClient;
    roomId?: string;
    userId?: string;
}

export class MatrixMessageProcessor {
    private guild: Discord.Guild;
    private listDepth: number = 0;
    private listBulletPoints: string[] = ["●", "○", "■", "‣"];
    private params?: IMatrixMessageProcessorParams;
    constructor(public bot: DiscordBot) { }
    public async FormatMessage(
        msg: IMatrixMessage,
        guild: Discord.Guild,
        params?: IMatrixMessageProcessorParams,
    ): Promise<string> {
        this.guild = guild;
        this.listDepth = 0;
        this.params = params;
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
            reply = reply.replace(/\s*$/, ""); // trim off whitespace at end
        } else {
            reply = await this.escapeDiscord(msg.body);
        }

        if (msg.msgtype === "m.emote") {
            if (params &&
                params.displayname &&
                params.displayname.length >= MIN_NAME_LENGTH &&
                params.displayname.length <= MAX_NAME_LENGTH) {
                reply = `_${await this.escapeDiscord(params.displayname)} ${reply}_`;
            } else {
                reply = `_${reply}_`;
            }
        }
        return reply;
    }

    private async canNotifyRoom() {
        if (!this.params || !this.params.mxClient || !this.params.roomId || !this.params.userId) {
            return false;
        }
        return await Util.CheckMatrixPermission(
            this.params.mxClient,
            this.params.userId,
            this.params.roomId,
            DEFAULT_ROOM_NOTIFY_POWER_LEVEL,
            "notifications",
            "room",
        );
    }

    private async escapeDiscord(msg: string): Promise<string> {
        // \u200B is the zero-width space --> they still look the same but don't mention
        msg = msg.replace(/@everyone/g, "@\u200Beveryone");
        msg = msg.replace(/@here/g, "@\u200Bhere");

        // Check the Matrix permissions to see if this user has the required
        // power level to notify with @room; if so, replace it with @here.
        if (msg.includes("@room") && await this.canNotifyRoom()) {
            msg = msg.replace(/@room/g, "@here");
        }
        const escapeChars = ["\\", "*", "_", "~", "`", "|"];
        msg = msg.split(" ").map((s) => {
            if (s.match(/^https?:\/\//)) {
                return s;
            }
            escapeChars.forEach((char) => {
                s = s.replace(new RegExp("\\" + char, "g"), "\\" + char);
            });
            return s;
        }).join(" ");
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

    private parseUser(id: string): string {
        const USER_REGEX = /^@_discord_([0-9]*)/;
        const match = id.match(USER_REGEX);
        if (!match || !this.guild.members.get(match[1])) {
            return "";
        }
        return `<@${match[1]}>`;
    }

    private async parseChannel(id: string): Promise<string> {
        const CHANNEL_REGEX = /^#_discord_[0-9]*_([0-9]*):/;
        const match = id.match(CHANNEL_REGEX);
        if (!match || !this.guild.channels.get(match[1])) {
            /*
            This isn't formatted in #_discord_, so let's fetch the internal room ID
            and see if it is still a bridged room!
            */
            if (this.params && this.params.mxClient) {
                try {
                    const resp = await this.params.mxClient.getRoomIdForAlias(id);
                    if (resp && resp.room_id) {
                        const roomId = resp.room_id;
                        const channel = await this.bot.GetChannelFromRoomId(roomId);
                        return `<#${channel.id}>`;
                    }
                } catch (err) { } // ignore, room ID wasn't found
            }
            return "";
        }
        return `<#${match[1]}>`;
    }

    private async parseLinkContent(node: Parser.HTMLElement): Promise<string> {
        const attrs = node.attributes;
        const content = await this.walkChildNodes(node);
        if (!attrs.href || content === attrs.href) {
            return content;
        }
        return `[${content}](${attrs.href})`;
    }

    private async parsePillContent(node: Parser.HTMLElement): Promise<string> {
        const attrs = node.attributes;
        if (!attrs.href || !attrs.href.startsWith(MATRIX_TO_LINK)) {
            return await this.parseLinkContent(node);
        }
        const id = attrs.href.replace(MATRIX_TO_LINK, "");
        let reply = "";
        switch (id[0]) {
            case "@":
                // user pill
                reply = this.parseUser(id);
                break;
            case "#":
                reply = await this.parseChannel(id);
                break;
        }
        if (!reply) {
            return await this.parseLinkContent(node);
        }
        return reply;
    }

    private async parseImageContent(node: Parser.HTMLElement): Promise<string> {
        const EMOTE_NAME_REGEX = /^:?(\w+):?/;
        const attrs = node.attributes;
        const name = attrs.alt || attrs.title || "";
        let emoji: Discord.Emoji | null = null;
        // first check for matching mxc url
        if (attrs.src) {
            let id = "";
            try {
                const emojiDb = await this.bot.GetEmojiByMxc(attrs.src);
                id = emojiDb.EmojiId;
                emoji = this.guild.emojis.find((e) => e.id === id);
            } catch (e) {
                emoji = null;
            }
        }
        // nexc check for matching alt text / title
        if (!emoji) {
            const match = name.match(EMOTE_NAME_REGEX);
            let emojiName = "";
            if (match) {
                emojiName = match[1];
                emoji = this.guild.emojis.find((e) => e.name === emojiName);
            }
        }

        if (!emoji) {
            const content = await this.escapeDiscord(name);
            const url = this.params && this.params.mxClient ? this.params.mxClient.mxcUrlToHttp(attrs.src) : attrs.src;
            return attrs.src ? `[${content}](${url})` : content;
        }
        return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
    }

    private async parseBlockquoteContent(node: Parser.HTMLElement): Promise<string> {
        let msg = await this.walkChildNodes(node);

        msg = msg.split("\n").map((s) => {
            return "> " + s;
        }).join("\n");
        msg = msg + "\n\n";
        return msg;
    }

    private async parseUlContent(node: Parser.HTMLElement): Promise<string> {
        this.listDepth++;
        const entries = await this.arrayChildNodes(node, ["li"]);
        this.listDepth--;
        const bulletPoint = this.listBulletPoints[this.listDepth % this.listBulletPoints.length];

        let msg = entries.map((s) => {
            return `${"    ".repeat(this.listDepth)}${bulletPoint} ${s}`;
        }).join("\n");

        if (this.listDepth === 0) {
            msg = `\n${msg}\n\n`;
        }
        return msg;
    }

    private async parseOlContent(node: Parser.HTMLElement): Promise<string> {
        this.listDepth++;
        const entries = await this.arrayChildNodes(node, ["li"]);
        this.listDepth--;
        let entry = 0;
        const attrs = node.attributes;
        if (attrs.start && attrs.start.match(/^[0-9]+$/)) {
            entry = parseInt(attrs.start, 10) - 1;
        }

        let msg = entries.map((s) => {
            entry++;
            return `${"    ".repeat(this.listDepth)}${entry}. ${s}`;
        }).join("\n");

        if (this.listDepth === 0) {
            msg = `\n${msg}\n\n`;
        }
        return msg;
    }

    private async arrayChildNodes(node: Parser.Node, types: string[] = []): Promise<string[]> {
        const replies: string[] = [];
        await Util.AsyncForEach(node.childNodes, async (child) => {
            if (types.length && (
                child.nodeType === Parser.NodeType.TEXT_NODE
                || !types.includes((child as Parser.HTMLElement).tagName)
            )) {
                return;
            }
            replies.push(await this.walkNode(child));
        });
        return replies;
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
            // ignore \n between single nodes
            if ((node as Parser.TextNode).text === "\n") {
                return "";
            }
            return await this.escapeDiscord((node as Parser.TextNode).text);
        } else if (node.nodeType === Parser.NodeType.ELEMENT_NODE) {
            const nodeHtml = node as Parser.HTMLElement;
            switch (nodeHtml.tagName) {
                case "em":
                case "i":
                    return `*${await this.walkChildNodes(nodeHtml)}*`;
                case "strong":
                case "b":
                    return `**${await this.walkChildNodes(nodeHtml)}**`;
                case "u":
                    return `__${await this.walkChildNodes(nodeHtml)}__`;
                case "del":
                    return `~~${await this.walkChildNodes(nodeHtml)}~~`;
                case "code":
                    return `\`${nodeHtml.text}\``;
                case "pre":
                    return `\`\`\`${this.parsePreContent(nodeHtml)}\`\`\``;
                case "a":
                    return await this.parsePillContent(nodeHtml);
                case "img":
                    return await this.parseImageContent(nodeHtml);
                case "br":
                    return "\n";
                case "blockquote":
                    return await this.parseBlockquoteContent(nodeHtml);
                case "ul":
                    return await this.parseUlContent(nodeHtml);
                case "ol":
                    return await this.parseOlContent(nodeHtml);
                case "mx-reply":
                    return "";
                case "hr":
                    return "\n----------\n";
                case "h1":
                case "h2":
                case "h3":
                case "h4":
                case "h5":
                case "h6":
                    const level = parseInt(nodeHtml.tagName[1], 10);
                    return `**${"#".repeat(level)} ${await this.walkChildNodes(nodeHtml)}**\n`;
                default:
                    return await this.walkChildNodes(nodeHtml);
            }
        }
        return "";
    }
}
