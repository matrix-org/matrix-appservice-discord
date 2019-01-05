import {MockMember} from "./member";
import {MockCollection} from "./collection";
import {Permissions, PermissionResolvable} from "discord.js";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

// Mocking TextChannel
export class MockChannel {
    public members = new MockCollection<string, MockMember>();
    constructor(
        public id: string = "",
        public guild: any = null,
        public type: string = "text",
        public name: string = "",
        public topic: string = "",
    ) { }

    public async send(data: any): Promise<any> {
        return data;
    }

    public permissionsFor(member: MockMember) {
        return new Permissions(Permissions.FLAGS.MANAGE_WEBHOOKS as PermissionResolvable);
    }
}
