import {MockMember} from "./member";
import {MockCollection} from "./collection";

// Mocking TextChannel
export class MockChannel {
    public members = new MockCollection<string, MockMember>();
    constructor (public id: string = "", public guild: any = null) { }
}
