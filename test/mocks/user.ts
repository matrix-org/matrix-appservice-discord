import { Presence } from "discord.js";

export class MockUser {
  public id = "";
  public username: string;
  public discriminator: string;
  public presence: Presence;
  constructor(id: string, username: string = "") {
    this.id = id;
    this.username = username;
  }

  public MockSetPresence(presence: Presence) {
      this.presence = presence;
  }
}
