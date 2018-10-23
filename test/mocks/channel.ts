import {MockMember} from "./member";
import {MockCollection} from "./collection";
import { MockGuild } from "./guild";

// Mocking TextChannel
export class MockChannel {
    public members = new MockCollection<string, MockMember>();
    constructor (
        public id: string = "",
        public guild: MockGuild = null,
        public type: string = "text",
        public name: string = "",
        public topic: string = "",
    ) { }
    public send(data: any): Promise<any> {
        return Promise.resolve(data);
    }
}
