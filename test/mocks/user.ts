import { Presence } from "discord.js";

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
