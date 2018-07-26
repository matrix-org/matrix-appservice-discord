import {MockUser} from "./user";
import * as Discord from "discord.js";

export class MockMember {
  public id = "";
  public presence: Discord.Presence;
  public user: MockUser;
  public nickname: string;
  constructor(id: string, username: string, public guild = null, public displayName: string = username) {
    this.id = id;
    this.presence = new Discord.Presence({});
    this.user = new MockUser(this.id, username);
    this.nickname = displayName;
  }

  public MockSetPresence(presence: Discord.Presence) {
      this.presence = presence;
  }
}
