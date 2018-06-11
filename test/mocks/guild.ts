import {MockCollection} from "./collection";
import {MockMember} from "./member";
import {MockEmoji} from "./emoji";
import {Channel} from "discord.js";

export class MockGuild {
  public channels = new MockCollection<string, Channel>();
  public members = new MockCollection<string, MockMember>();
  public emojis = new MockCollection<string, MockEmoji>();
  public id: string;
  public name: string;
  constructor(id: string, channels: any[] = [], name: string = null) {
    this.id = id;
    this.name = name || id;
    channels.forEach((item) => {
      this.channels.set(item.id, item);
    });
  }

  public _mockAddMember(member: MockMember) {
      this.members.set(member.id, member);
  }
}
