import {MockCollection} from "./collection";
import {MockGuild} from "./guild";
import {MockUser} from "./user";

export class MockDiscordClient {
  public guilds = new MockCollection<string, MockGuild>();
  public user: MockUser;
  private testLoggedIn: boolean = false;
  private testCallbacks: Array<() => void> = [];

  constructor() {
    const channels = [
      {
        id: "321",
        name: "achannel",
        type: "text",
      }, {
        id: "654",
        name: "a-channel",
        type: "text",
      }, {
        id: "987",
        name: "a channel",
        type: "text",
      },
    ];
    this.guilds.set("123", new MockGuild("MyGuild", channels));
    this.guilds.set("456", new MockGuild("My Spaces Gui", channels));
    this.guilds.set("789", new MockGuild("My Dash-Guild", channels));
    this.user = new MockUser("12345");
  }

  public on(event: string, callback: () => void) {
    if (event === "ready") {
      this.testCallbacks[0] = callback;
    }
  }

  public login(token: string) {
    this.testLoggedIn = true;
    this.testCallbacks[0]();
  }
}
