import {DiscordClientFactory} from "./discordclientfactory"

export class MockDiscordClient {
  public guilds = new MockCollection<string, MockGuild>();
  public user: MockUser;
  private testLoggedIn: boolean = false;
  private testCallbacks: Array<() => void> = [];

  constructor() {
    this.user = new MockUser("12345");
    const memberList1 = new MockCollection<string, MockUser>();
    memberList1.set("8374", new MockUser("8374"));
    const webhooks = new MockCollection<string, MockWebhook>();
    webhooks.set("alsdkjfas", new MockWebhook("_matrix"));
    const channels = [
      new MockChannel({
        id: "321",
        name: "achannel",
        type: "text",
        members: memberList1,
        webhooks: webhooks,
      }),
      new MockChannel({
        id: "654",
        name: "a-channel",
        type: "text",
      }), 
      new MockChannel({
        id: "987",
        name: "a channel",
        type: "text",
      }),
    ];
    this.guilds.set("123", new MockGuild("MyGuild", channels));
    this.guilds.set("456", new MockGuild("My Spaces Gui", channels));
    this.guilds.set("789", new MockGuild("My Dash-Guild", channels));
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

class MockMember {
  public id = "";
  constructor(id: string) {
    this.id = id;
  }
}

class MockUser {
  public id = "";
  constructor(id: string) {
    this.id = id;
  }
}

class MockChannel {
  public id: string;
  public name: string;
  public type: string;
  public members = new MockCollection<string, MockMember>();
  private webhooks = new MockCollection<string, MockWebhook>();
  constructor(conf: any) {
    this.id = conf.id;
    this.name = conf.name;
    this.type = conf.type;
    if (conf.members) {
      this.members = conf.members;
    }
    if (conf.webhooks) {
      this.webhooks = conf.webhooks;
    }
  }
  fetchWebhooks() {
    return Promise.resolve(this.webhooks);
  }
  send() {
    DiscordClientFactory.sentMessages.push(arguments);
    return Promise.resolve({
      id: "messageid",
    });
  }
}

class MockWebhook {
  send() {
    DiscordClientFactory.sentWebhookMessages.push(arguments);
    return Promise.resolve({
      id: "messageid",
    });
  }
  public name: string;
  constructor(name: string) {
    this.name = name;
  }
}

class MockGuild {
  public channels = new MockCollection<string, MockChannel>();
  public members = new MockCollection<string, MockMember>();
  public id: string;
  constructor(id: string, channels: any[]) {
    this.id = id;
    channels.forEach((item) => {
      this.channels.set(item.id, item);
    });
  }
}

class MockCollection<T1, T2> extends Map {
  public array(): T2[] {
    return [...this.values()];
  }

  public keyArray(): T1[] {
    return [...this.keys()];
  }

  public filterArray(fn: (any) => boolean): T2[] {
    return [...this.values()].filter(fn);
  }
}
