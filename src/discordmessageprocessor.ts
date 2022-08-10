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

import * as Discord from "better-discord.js";
import { DiscordBot } from "./bot";
import { Log } from "./log";
import {
    DiscordMessageParser,
    IDiscordMessageParserOpts,
    IDiscordMessageParserCallbacks,
    IDiscordMessageParserResult,
} from "@mx-puppet/matrix-discord-parser";

const log = new Log("DiscordMessageProcessor");

export class DiscordMessageProcessor {
    private parser: DiscordMessageParser;
    constructor(private domain: string, private bot: DiscordBot) {
        this.parser = new DiscordMessageParser();
    }

    public async FormatMessage(msg: Discord.Message): Promise<IDiscordMessageParserResult> {
        const opts = {
            callbacks: this.getParserCallbacks(msg),
        } as IDiscordMessageParserOpts;
        return await this.parser.FormatMessage(opts, msg);
    }

    public async FormatEdit(
        msg1: Discord.Message,
        msg2: Discord.Message,
        link: string,
    ): Promise<IDiscordMessageParserResult> {
        // obsolete once edit PR is merged
        const opts = {
            callbacks: this.getParserCallbacks(msg2),
        } as IDiscordMessageParserOpts;
        return await this.parser.FormatEdit(opts, msg1, msg2, link);
    }

    private getParserCallbacks(msg: Discord.Message): IDiscordMessageParserCallbacks {
        return {
            getChannel: async (id: string) => {
                const channel = msg.guild?.channels.resolve(id);
                if (!channel) {
                    return null;
                }
                const alias = await this.bot.ChannelSyncroniser.GetAliasFromChannel(channel);
                if (!alias) {
                    return null;
                }
                return {
                    mxid: alias,
                    name: channel.name,
                };
            },
            getEmoji: async (name: string, animated: boolean, id: string) => {
                try {
                    const mxcUrl = await this.bot.GetEmoji(name, animated, id);
                    return mxcUrl;
                } catch (ex) {
                    log.warn(`Could not get emoji ${id} with name ${name}`, ex);
                }
                return null;
            },
            getUser: async (id: string) => {
                const member = msg.guild?.members.resolve(id);
                const mxid = `@_discord_${id}:${this.domain}`;
                const name = member ? member.displayName : mxid;
                return {
                    mxid,
                    name,
                };
            },
        };
    }

}
