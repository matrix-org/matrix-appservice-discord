import {MockMember} from "./member";
import {MockCollection} from "./collection";
import { MockGuild } from "./guild";

// Mocking TextChannel
export class MockChannel {
    public members = new MockCollection<string, MockMember>();
    public type = "text";
    constructor (public id: string = "", public guild: MockGuild = null) { }
    public send(data: any): Promise<any> {
        return Promise.resolve(data);
    }
}
