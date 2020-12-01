import { MockUser } from "./user";

/* tslint:disable:no-unused-expression max-file-line-count no-any */
export class MockPresence {
    constructor(public internalUser: MockUser, guild: string, public status?: string, public activities: any = []) {

    }

    public get user() {
        return this.internalUser;
    }

    public get userID() {
        return this.internalUser.id;
    }
}
