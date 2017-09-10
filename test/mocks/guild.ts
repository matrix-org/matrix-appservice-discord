import {MockCollection} from "./collection";
import {MockMember} from "./member";

export class MockGuild {
  public channels = new MockCollection<string, any>();
  public members = new MockCollection<string, MockMember>();
  public id: string;
  constructor(id: string, channels: any[]) {
    this.id = id;
    channels.forEach((item) => {
      this.channels.set(item.id, item);
    });
  }

  public _mockAddMember(member: MockMember) {
      this.members.set(member.id, member);
  }
}
