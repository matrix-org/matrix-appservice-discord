export class MockUser {
  constructor(
      public id: string,
      public username: string = "",
      public discriminator: string = "",
      public avatarURL: string = "",
      public avatar: string = "",
  ) { }
}
