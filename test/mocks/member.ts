import {MockUser} from "./user";

export class MockMember {
  public id = "";
  public presence = {status: "offline"}; // TODO: Mock this
  public user: MockUser;
  constructor(id: string, username: string) {
    this.id = id;
    this.user = new MockUser(this.id, username);
  }
}
