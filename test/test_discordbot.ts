import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import * as Proxyquire from "proxyquire";
import * as log from "npmlog";

Chai.use(ChaiAsPromised);
log.level = "silent";

const assert = Chai.assert;
// const should = Chai.should as any;

const mockBridge = {
  getRoomStore: () => {
    return {
      getEntriesByRemoteRoomData: (data) => {
        if (data.discord_channel === "321") {
          return Promise.resolve([{
            matrix: {
              getId: () => "foobar:example.com",
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

const modDiscordBot = Proxyquire("../src/bot", {
  "./clientfactory": require("./mocks/discordclientfactory"),
});
describe("DiscordBot", () => {
  let discordBot;
  const config = {
    auth: {
        botToken: "blah",
    },
    bridge: {
        domain: "localhost",
    },
  };
  describe("run()", () => {
    it("should resolve when ready.", () => {
      discordBot = new modDiscordBot.DiscordBot(
        config,
        mockBridge,
      );
      return discordBot.run();
    });
  });

  describe("LookupRoom()", () => {
    beforeEach(() => {
      discordBot = new modDiscordBot.DiscordBot(
        config,
        mockBridge,
      );
      return discordBot.run();
    });
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
  // describe("OnTyping()", () => {
  //   const discordBot = new modDiscordBot.DiscordBot(
  //     config,
  //   );
  //   discordBot.setBridge(mockBridge);
  //   discordBot.run();
  //   it("should reject an unknown room.", () => {
  //     return assert.isRejected(discordBot.OnTyping( {id: "512"}, {id: "12345"}, true));
  //   });
  //   it("should resolve a known room.", () => {
  //     return assert.isFulfilled(discordBot.OnTyping( {id: "321"}, {id: "12345"}, true));
  //   });
  // });
  // describe("OnMessage()", () => {
  //
  // });
});
