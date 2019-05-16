/*
Copyright 2017 - 2019 matrix-appservice-discord

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
import * as markdown from "discord-markdown";
import { DiscordBot } from "./bot";
import * as escapeHtml from "escape-html";
import { Util } from "./util";
import { Bridge } from "matrix-appservice-bridge";

import { Log } from "./log";
const log = new Log("DiscordMessageProcessor");

const MATRIX_TO_LINK = "https://matrix.to/#/";
// somehow the regex works properly if it isn't global
// as we replace the match fully anyways this shouldn't be an issue
const MXC_INSERT_REGEX = /\x01emoji\x01(\w+)\x01([01])\x01([0-9]*)\x01/;
const NAME_MXC_INSERT_REGEX_GROUP = 1;
const ANIMATED_MXC_INSERT_REGEX_GROUP = 2;
const ID_MXC_INSERT_REGEX_GROUP = 3;
const EMOJI_SIZE = 32;
const MAX_EDIT_MSG_LENGTH = 50;

// same as above, no global flag here, too
const CHANNEL_INSERT_REGEX = /\x01chan\x01([0-9]*)\x01/;
const ID_CHANNEL_INSERT_REGEX = 1;

export class DiscordMessageProcessorOpts {
    constructor(readonly domain: string, readonly bot?: DiscordBot) {

    }
}

export class DiscordMessageProcessorResult {
    public formattedBody: string;
    public body: string;
    public msgtype: string;
}

interface IDiscordNode {
    id: string;
}

interface IEmojiNode extends IDiscordNode {
    animated: boolean;
    name: string;
}

export class DiscordMessageProcessor {
    private readonly opts: DiscordMessageProcessorOpts;
    constructor(opts: DiscordMessageProcessorOpts, bot: DiscordBot | null = null) {
        // Backwards compat
        if (bot !== null) {
            this.opts = new DiscordMessageProcessorOpts(opts.domain, bot);
        } else {
            this.opts = opts;
        }
    }

    public async FormatMessage(msg: Discord.Message): Promise<DiscordMessageProcessorResult> {
        const result = new DiscordMessageProcessorResult();

        let content = msg.content;

        // for the formatted body we need to parse markdown first
        // as else it'll HTML escape the result of the discord syntax
        let contentPostmark = markdown.toHTML(content, {
            discordCallback: this.getDiscordParseCallbacksHTML(msg),
        });

        // parse the plain text stuff
        content = markdown.toHTML(content, {
            discordCallback: this.getDiscordParseCallbacks(msg),
            discordOnly: true,
            escapeHTML: false,
        });
        content = this.InsertEmbeds(content, msg);
        content = await this.InsertMxcImages(content, msg);
        content = await this.InsertChannelPills(content, msg);

        // parse postmark stuff
        contentPostmark = this.InsertEmbedsPostmark(contentPostmark, msg);
        contentPostmark = await this.InsertMxcImages(contentPostmark, msg, true);
        contentPostmark = await this.InsertChannelPills(contentPostmark, msg, true);

        result.body = content;
        result.formattedBody = contentPostmark;
        result.msgtype = msg.author.bot ? "m.notice" : "m.text";
        return result;
    }

    public async FormatEdit(
        oldMsg: Discord.Message,
        newMsg: Discord.Message,
        link?: string,
    ): Promise<DiscordMessageProcessorResult> {
        oldMsg.embeds = []; // we don't want embeds on old msg
        const oldMsgParsed = await this.FormatMessage(oldMsg);
        const newMsgParsed = await this.FormatMessage(newMsg);
        const result = new DiscordMessageProcessorResult();
        result.body = `*edit:* ~~${oldMsgParsed.body}~~ -> ${newMsgParsed.body}`;
        result.msgtype = newMsgParsed.msgtype;
        oldMsg.content = `*edit:* ~~${oldMsg.content}~~ -> ${newMsg.content}`;
        const linkStart = link ? `<a href="${escapeHtml(link)}">` : "";
        const linkEnd = link ? "</a>" : "";
        if (oldMsg.content.includes("\n") || newMsg.content.includes("\n")
            || newMsg.content.length > MAX_EDIT_MSG_LENGTH) {
            result.formattedBody = `<p>${linkStart}<em>edit:</em>${linkEnd}</p><p><del>${oldMsgParsed.formattedBody}` +
                `</del></p><hr><p>${newMsgParsed.formattedBody}</p>`;
        } else {
            result.formattedBody = `${linkStart}<em>edit:</em>${linkEnd} <del>${oldMsgParsed.formattedBody}</del>` +
                ` -&gt; ${newMsgParsed.formattedBody}`;
        }
        return result;
    }

    public InsertEmbeds(content: string, msg: Discord.Message): string {
        for (const embed of msg.embeds) {
            if (embed.title === undefined && embed.description === undefined) {
                continue;
            }
            if (this.isEmbedInBody(msg, embed)) {
                continue;
            }
            let embedContent = "\n\n----"; // Horizontal rule. Two to make sure the content doesn't become a title.
            const embedTitle = embed.url ? `[${embed.title}](${embed.url})` : embed.title;
            if (embedTitle) {
                embedContent += "\n##### " + embedTitle; // h5 is probably best.
            }
            if (embed.description) {
                embedContent += "\n" + markdown.toHTML(embed.description, {
                    discordCallback: this.getDiscordParseCallbacks(msg),
                    discordOnly: true,
                    escapeHTML: false,
                });
            }
            if (embed.fields) {
                for (const field of embed.fields) {
                    embedContent += `\n**${field.name}**\n`;
                    embedContent += markdown.toHTML(field.value, {
                        discordCallback: this.getDiscordParseCallbacks(msg),
                        discordOnly: true,
                        escapeHTML: false,
                    });
                }
            }
            if (embed.image) {
                embedContent += "\nImage: " + embed.image.url;
            }
            if (embed.footer) {
                embedContent += "\n" + markdown.toHTML(embed.footer.text, {
                    discordCallback: this.getDiscordParseCallbacks(msg),
                    discordOnly: true,
                    escapeHTML: false,
                });
            }
            content += embedContent;
        }
        return content;
    }

    public InsertEmbedsPostmark(content: string, msg: Discord.Message): string {
        for (const embed of msg.embeds) {
            if (embed.title === undefined && embed.description === undefined) {
                continue;
            }
            if (this.isEmbedInBody(msg, embed)) {
                continue;
            }
            let embedContent = "<hr>"; // Horizontal rule. Two to make sure the content doesn't become a title.
            const embedTitle = embed.url ?
                `<a href="${escapeHtml(embed.url)}">${escapeHtml(embed.title)}</a>`
                : (embed.title ? escapeHtml(embed.title) : undefined);
            if (embedTitle) {
                embedContent += `<h5>${embedTitle}</h5>`; // h5 is probably best.
            }
            if (embed.description) {
                embedContent += "<p>";
                embedContent += markdown.toHTML(embed.description, {
                    discordCallback: this.getDiscordParseCallbacksHTML(msg),
                    embed: true,
                }) + "</p>";
            }
            if (embed.fields) {
                for (const field of embed.fields) {
                    embedContent += `<p><strong>${escapeHtml(field.name)}</strong><br>`;
                    embedContent += markdown.toHTML(field.value, {
                        discordCallback: this.getDiscordParseCallbacks(msg),
                        embed: true,
                    }) + "</p>";
                }
            }
            if (embed.image) {
                const imgUrl = escapeHtml(embed.image.url);
                embedContent += `<p>Image: <a href="${imgUrl}">${imgUrl}</a></p>`;
            }
            if (embed.footer) {
                embedContent += "<p>";
                embedContent += markdown.toHTML(embed.footer.text, {
                    discordCallback: this.getDiscordParseCallbacksHTML(msg),
                    embed: true,
                }) + "</p>";
            }
            content += embedContent;
        }
        return content;
    }

    public InsertUser(node: IDiscordNode, msg: Discord.Message, html: boolean = false): string {
        const id = node.id;
        const member = msg.guild.members.get(id);
        const memberId = `@_discord_${id}:${this.opts.domain}`;
        const memberName = member ? member.displayName : memberId;
        if (!html) {
            return memberName;
        }
        return `<a href="${MATRIX_TO_LINK}${escapeHtml(memberId)}">${escapeHtml(memberName)}</a>`;
    }

    public InsertChannel(node: IDiscordNode): string {
        // unfortunately these callbacks are sync, so we flag our channel with some special stuff
        // and later on grab the real channel pill async
        const FLAG = "\x01";
        return `${FLAG}chan${FLAG}${node.id}${FLAG}`;
    }

    public InsertRole(node: IDiscordNode, msg: Discord.Message, html: boolean = false): string {
        const id = node.id;
        const role = msg.guild.roles.get(id);
        if (!role) {
            return html ? `&lt;@&amp;${id}&gt;` : `<@&${id}>`;
        }
        if (!html) {
            return `@${role.name}`;
        }
        const color = Util.NumberToHTMLColor(role.color);
        return `<span data-mx-color="${color}"><strong>@${escapeHtml(role.name)}</strong></span>`;
    }

    public InsertEmoji(node: IEmojiNode): string {
        // unfortunately these callbacks are sync, so we flag our url with some special stuff
        // and later on grab the real url async
        const FLAG = "\x01";
        return `${FLAG}emoji${FLAG}${node.name}${FLAG}${node.animated ? 1 : 0}${FLAG}${node.id}${FLAG}`;
    }

    public InsertRoom(msg: Discord.Message, def: string): string {
        return msg.mentions.everyone ? "@room" : def;
    }

    public async InsertMxcImages(content: string, msg: Discord.Message, html: boolean = false): Promise<string> {
        let results = MXC_INSERT_REGEX.exec(content);
        while (results !== null) {
            const name = results[NAME_MXC_INSERT_REGEX_GROUP];
            const animated = results[ANIMATED_MXC_INSERT_REGEX_GROUP] === "1";
            const id = results[ID_MXC_INSERT_REGEX_GROUP];
            let replace = "";
            const nameHtml = escapeHtml(name);
            try {
                const mxcUrl = await this.opts.bot!.GetEmoji(name, animated, id);
                if (html) {
                    replace = `<img alt="${nameHtml}" title="${nameHtml}" ` +
                        `height="${EMOJI_SIZE}" src="${mxcUrl}" />`;
                } else {
                    replace = `:${name}:`;
                }
            } catch (ex) {
                log.warn(
                    `Could not insert emoji ${id} for msg ${msg.id} in guild ${msg.guild.id}: ${ex}`,
                );
                if (html) {
                    replace = `&lt;${animated ? "a" : ""}:${nameHtml}:${id}&gt;`;
                } else {
                    replace = `<${animated ? "a" : ""}:${name}:${id}>`;
                }
            }
            content = content.replace(results[0], replace);
            results = MXC_INSERT_REGEX.exec(content);
        }
        return content;
    }

    public async InsertChannelPills(content: string, msg: Discord.Message, html: boolean = false): Promise<string> {
        let results = CHANNEL_INSERT_REGEX.exec(content);
        while (results !== null) {
            const id = results[ID_CHANNEL_INSERT_REGEX];
            let replace = "";
            const channel = msg.guild.channels.get(id);
            if (channel) {
                const alias = await this.opts.bot!.ChannelSyncroniser.GetAliasFromChannel(channel);
                if (alias) {
                    const name = "#" + channel.name;
                    replace = html ? `<a href="${MATRIX_TO_LINK}${escapeHtml(alias)}">${escapeHtml(name)}</a>` : name;
                }
            }
            if (!replace) {
                replace = html ? `&lt;#${escapeHtml(id)}&gt;` : `<#${id}>`;
            }
            content = content.replace(results[0], replace);
            results = CHANNEL_INSERT_REGEX.exec(content);
        }
        return content;
    }

    private isEmbedInBody(msg: Discord.Message, embed: Discord.MessageEmbed): boolean {
        if (!embed.url) {
            return false;
        }
        let url = embed.url;
        if (url.substr(url.length - 1) === "/") {
            url = url.substr(0, url.length - 1);
        }
        return msg.content.includes(url);
    }

    private getDiscordParseCallbacks(msg: Discord.Message) {
        return {
            channel: (node) => this.InsertChannel(node), // are post-inserted
            emoji: (node) => this.InsertEmoji(node), // are post-inserted
            everyone: (_) => this.InsertRoom(msg, "@everyone"),
            here: (_) => this.InsertRoom(msg, "@here"),
            role: (node) => this.InsertRole(node, msg),
            user: (node) => this.InsertUser(node, msg),
        };
    }

    private getDiscordParseCallbacksHTML(msg: Discord.Message) {
        return {
            channel: (node) => this.InsertChannel(node), // are post-inserted
            emoji: (node) => this.InsertEmoji(node), // are post-inserted
            everyone: (_) => this.InsertRoom(msg, "@everyone"),
            here: (_) => this.InsertRoom(msg, "@here"),
            role: (node) => this.InsertRole(node, msg, true),
            user: (node) => this.InsertUser(node, msg, true),
        };
    }
}
