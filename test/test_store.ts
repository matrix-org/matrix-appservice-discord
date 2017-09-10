import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
// import * as Proxyquire from "proxyquire";
import { DiscordStore } from "../src/store";
import * as log from "npmlog";
import { DbGuildEmoji } from "../src/db/dbdataemoji";

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
  describe("Get|Insert|Update<DbGuildEmoji>", () => {
    it("should insert successfully", () => {
      const store = new DiscordStore(":memory:");
      return expect(store.init().then(() => {
        const emoji = new DbGuildEmoji();
        emoji.EmojiId = "123";
        emoji.GuildId = "456";
        emoji.Name = "TestEmoji";
        emoji.MxcUrl = "TestUrl";
        return store.Insert(emoji);
      })).to.eventually.be.fulfilled;
    });
    it("should get successfully", async function() {
        const store = new DiscordStore(":memory:");
        await store.init();
        const insert_emoji = new DbGuildEmoji();
        insert_emoji.EmojiId = "123";
        insert_emoji.GuildId = "456";
        insert_emoji.Name = "TestEmoji";
        insert_emoji.MxcUrl = "TestUrl";
        await store.Insert(insert_emoji);
        const get_emoji = await store.Get(DbGuildEmoji, {emoji_id: "123"});
        Chai.assert.equal(get_emoji.Name, "TestEmoji");
        Chai.assert.equal(get_emoji.MxcUrl, "TestUrl");
    });
    it("should not return nonexistant emoji", async function() {
        const store = new DiscordStore(":memory:");
        await store.init();
        const get_emoji = await store.Get(DbGuildEmoji, {emoji_id: "123"});
        Chai.assert.isFalse(get_emoji.Result);
    });
    it("should update successfully", async function() {
        const store = new DiscordStore(":memory:");
        await store.init();
        const insert_emoji = new DbGuildEmoji();
        insert_emoji.EmojiId = "123";
        insert_emoji.GuildId = "456";
        insert_emoji.Name = "TestEmoji";
        insert_emoji.MxcUrl = "TestUrl";
        await store.Insert(insert_emoji);
        insert_emoji.EmojiId = "123";
        insert_emoji.GuildId = "456";
        insert_emoji.Name = "TestEmoji2";
        insert_emoji.MxcUrl = "NewURL";
        await store.Update(insert_emoji);
        const get_emoji = await store.Get(DbGuildEmoji, {emoji_id: "123"});
        Chai.assert.equal(get_emoji.Name, "TestEmoji2");
        Chai.assert.equal(get_emoji.MxcUrl, "NewURL");
        Chai.assert.notEqual(get_emoji.CreatedAt,get_emoji.UpdatedAt);
    });
  });
});
