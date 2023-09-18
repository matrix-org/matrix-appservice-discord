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

import * as Discord from "@mx-puppet/better-discord.js";
import { MockUser } from "./user";
import { MockCollection } from "./collection";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

export class MockMessage {
    public attachments = new MockCollection<string, any>();
    public embeds: any[] = [];
    public content: string;
    public channel: Discord.TextChannel | undefined;
    public guild: Discord.Guild | undefined;
    public author: MockUser;
    public mentions: any = {};

    constructor(
        channel?: Discord.TextChannel,
        content: string = "",
        author: MockUser = new MockUser("123456"),
    ) {
        this.mentions.everyone = false;
        this.channel = channel;
        if (channel && channel.guild) {
            this.guild = channel.guild;
        }
        this.content = content;
        this.author = author;
    }
}
