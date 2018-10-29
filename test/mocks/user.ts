import { Presence } from "discord.js";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

export class MockUser {
    public presence: Presence;
    constructor(
        public id: string,
        public username: string = "",
        public discriminator: string = "",
        public avatarURL: string = "",
        public avatar: string = "",
    ) { }

    public MockSetPresence(presence: Presence) {
        this.presence = presence;
    }
}
