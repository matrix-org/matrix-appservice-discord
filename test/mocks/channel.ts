import {MockMember} from "./member";
import {MockCollection} from "./collection";

// Mocking TextChannel
export class MockChannel {
    constructor (public id: string = "", public guild: any = null) { }
    public members = new MockCollection<string, MockMember>();
}
