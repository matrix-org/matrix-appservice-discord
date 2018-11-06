import {MockMember} from "./member";
import {MockCollection} from "./collection";

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
}
