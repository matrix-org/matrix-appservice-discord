import {MockCollection} from "./collection";
import {MockUser} from "./user";
import {MockRole} from "./role";
import * as Discord from "discord.js";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

export class MockMember {
    public id = "";
    public presence: Discord.Presence;
    public user: MockUser;
    public nickname: string;
    public roles = new MockCollection<string, MockRole>();
    constructor(id: string, username: string, public guild: any = null, public displayName: string = username) {
        this.id = id;
        this.presence = new Discord.Presence({}, {} as any);
        this.user = new MockUser(this.id, username);
        this.nickname = displayName;
    }

    public MockSetPresence(presence: Discord.Presence) {
        this.presence = presence;
    }
}
