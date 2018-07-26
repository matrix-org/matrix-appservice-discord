import {MockMember} from "./member";
import {MockCollection} from "./collection";

// Mocking TextChannel
export class MockChannel {
    public members = new MockCollection<string, MockMember>();
    constructor (
        public id: string = "",
        public guild: any = null,
        public type: string = "text",
        public name: string = "",
        public topic: string = "",
    ) { }
    public send(data: any): Promise<any> {
        return Promise.resolve(data);
    }
}
