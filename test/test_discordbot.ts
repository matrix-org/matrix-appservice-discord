import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import * as Proxyquire from "proxyquire";
import { DiscordBridgeConfig } from "../src/config";

Chai.use(ChaiAsPromised);

const assert = Chai.assert;
const should = Chai.should as any;
class DiscordClient {
  public guilds: any;
  private testLoggedIn: boolean = false;
  private testCallbacks: Array<() => void> = [];
  constructor() {
    let channels = [
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
    let guilds = [
      {
        id: "123",
        name: "MyGuild",
        channels,
      },
      {
        id: "456",
        name: "My Spaces Guild",
        channels,
      },
      {
        id: "789",
        name: "My Dash-Guild",
        channels,
      },
    ];
    this.guilds = guilds;

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

const mockDiscord = {
  Client: DiscordClient,
};

const mockBridge = {
  getRoomStore: () => {
    return {
      getEntriesByRemoteRoomData: (data) => {
        if (data.discord_channel === "321") {
          return Promise.resolve([{
            matrix: {
              getId: () => {return "foobar:example.com"; },
            },
          }]);
        }
        return Promise.resolve([]);
      },
    };
  },
  getIntentFromLocalpart: (localpart: string) => {
    return{
      sendTyping: (room: string, isTyping: boolean) => {
        return;
      },
    };
  },
};

const modDiscordBot = Proxyquire("../src/discordbot", {
  "discord.js": mockDiscord,
});

describe("DiscordBot", () => {
  const config = {
    auth: {
      botToken: "blah",
    },
  };
  describe("run()", () => {
    it("should start ok.", () => {
      const discordBot = new modDiscordBot.DiscordBot(
        config,
        mockBridge,
      );
      assert.doesNotThrow(discordBot.run.bind(discordBot));
    });
    it("should resolve when ready.", () => {
      const discordBot = new modDiscordBot.DiscordBot(
        config,
        mockBridge,
      );
      return discordBot.run();
    });
  });
  describe("LookupRoom()", () => {
    const discordBot = new modDiscordBot.DiscordBot(
      config,
      mockBridge,
    );
    discordBot.run();
    it("should reject a missing guild.", () => {
      return assert.isRejected(discordBot.LookupRoom("541", "321"));
    });

    it("should reject a missing channel.", () => {
      return assert.isRejected(discordBot.LookupRoom("123", "666"));
    });

    it("should resolve a guild and channel id.", () => {
      return assert.isFulfilled(discordBot.LookupRoom("123", "321"));
    });
  });
  // describe("ProcessMatrixMsgEvent()", () => {
  //
  // });
  // describe("UpdateRoom()", () => {
  //
  // });
  // describe("UpdateUser()", () => {
  //
  // });
  // describe("UpdatePresence()", () => {
  //
  // });
  describe("OnTyping()", () => {
    const discordBot = new modDiscordBot.DiscordBot(
      config,
    );
    discordBot.setBridge(mockBridge);
    discordBot.run();
    it("should reject an unknown room.", () => {
      return assert.isRejected(discordBot.OnTyping( {id: "512"}, {id: "12345"}, true));
    });
    it("should resolve a known room.", () => {
      return assert.isFulfilled(discordBot.OnTyping( {id: "321"}, {id: "12345"}, true));
    });
  });
  // describe("OnMessage()", () => {
  //
  // });
});
