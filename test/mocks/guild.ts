/*
Copyright 2017, 2018 matrix-appservice-discord

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

import {MockCollection} from "./collection";
import {MockMember} from "./member";
import {MockEmoji} from "./emoji";
import {Channel} from "discord.js";
import {MockRole} from "./role";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

export class MockGuild {
    public channels = new MockCollection<string, Channel>();
    public members = new MockCollection<string, MockMember>();
    public emojis = new MockCollection<string, MockEmoji>();
    public roles = new MockCollection<string, MockRole>();
    public id: string;
    public name: string;
    public icon: string;
    constructor(id: string, channels: any[] = [], name: string = "") {
        this.id = id;
        this.name = name || id;
        channels.forEach((item) => {
            this.channels.set(item.id, item);
        });
    }

    public async fetchMember(id: string): Promise<MockMember|Error> {
        if (this.members.has(id)) {
            return this.members.get(id)!;
        }
        throw new Error("Member not in this guild");
    }

    public _mockAddMember(member: MockMember) {
        this.members.set(member.id, member);
    }
}
