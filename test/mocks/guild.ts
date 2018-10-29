import {MockCollection} from "./collection";
import {MockMember} from "./member";
import {MockEmoji} from "./emoji";
import {Channel} from "discord.js";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

export class MockGuild {
    public channels = new MockCollection<string, Channel>();
    public members = new MockCollection<string, MockMember>();
    public emojis = new MockCollection<string, MockEmoji>();
    public id: string;
    public name: string;
    public icon: string;
    constructor(id: string, channels: any[] = [], name: string = null) {
        this.id = id;
        this.name = name || id;
        channels.forEach((item) => {
            this.channels.set(item.id, item);
        });
    }

    public async fetchMember(id: string): Promise<MockMember|Error> {
        if (this.members.has(id)) {
            return this.members.get(id);
        }
        throw new Error("Member not in this guild");
    }

    public _mockAddMember(member: MockMember) {
        this.members.set(member.id, member);
    }
}
