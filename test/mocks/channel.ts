import {MockUser} from "./user";
import * as Discord from "discord.js";
import {MockMember} from "./member";
import {MockCollection} from "./collection";

//Mocking TextChannel
export class MockChannel {
    public members = new MockCollection<string, MockMember>();
}
