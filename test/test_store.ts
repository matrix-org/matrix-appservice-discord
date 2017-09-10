import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
// import * as Proxyquire from "proxyquire";
import { DiscordStore } from "../src/store";
import * as log from "npmlog";

Chai.use(ChaiAsPromised);
const expect = Chai.expect;
log.level = "warn";

const TEST_SCHEMA = 4;

// const assert = Chai.assert;

describe("DiscordStore", () => {
  describe("init", () => {
    it("can create a db", () => {
      const store = new DiscordStore(":memory:");
      return store.init(-1);
    });
    for (let i = 1; i < TEST_SCHEMA; i++) {
        it("update schema to v" + i, () => {
          const store = new DiscordStore(":memory:");
          return store.init(i);
        });
    }
  });
  describe("add_user_token", () => {
    it("should not throw when adding an entry", () => {
      const store = new DiscordStore(":memory:");
      return expect(store.init().then(() => {
        return store.add_user_token("userid", "token", "discordid");
      })).to.eventually.be.fulfilled;
    });
  });
  describe("add_user_token", () => {
    it("should not throw when adding an entry", () => {
      const store = new DiscordStore(":memory:");
      return expect(store.init().then(() => {
        return store.add_user_token("userid", "token", "discordid");
      })).to.eventually.be.fulfilled;
    });
  });
});
