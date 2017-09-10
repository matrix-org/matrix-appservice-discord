import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
// import * as Proxyquire from "proxyquire";
import { DiscordStore } from "../src/store";
import * as log from "npmlog";
import { DbGuildEmoji } from "../src/db/dbdataemoji";
import { DbEvent } from "../src/db/dbdataevent";

Chai.use(ChaiAsPromised);
const expect = Chai.expect;
log.level = "warn";

const TEST_SCHEMA = 6;

// const assert = Chai.assert;

describe("DiscordStore", () => {
  describe("init", () => {
    it("can create a db", () => {
      const store = new DiscordStore(":memory:");
      return store.init();
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
    it("should get successfully", async () => {
        const store = new DiscordStore(":memory:");
        await store.init();
        const insertEmoji = new DbGuildEmoji();
        insertEmoji.EmojiId = "123";
        insertEmoji.GuildId = "456";
        insertEmoji.Name = "TestEmoji";
        insertEmoji.MxcUrl = "TestUrl";
        await store.Insert(insertEmoji);
        const getEmoji = await store.Get(DbGuildEmoji, {emoji_id: "123"});
        Chai.assert.equal(getEmoji.Name, "TestEmoji");
        Chai.assert.equal(getEmoji.MxcUrl, "TestUrl");
    });
    it("should not return nonexistant emoji", async () => {
        const store = new DiscordStore(":memory:");
        await store.init();
        const getEmoji = await store.Get(DbGuildEmoji, {emoji_id: "123"});
        Chai.assert.isFalse(getEmoji.Result);
    });
    it("should update successfully", async () => {
        const store = new DiscordStore(":memory:");
        await store.init();
        const insertEmoji = new DbGuildEmoji();
        insertEmoji.EmojiId = "123";
        insertEmoji.GuildId = "456";
        insertEmoji.Name = "TestEmoji";
        insertEmoji.MxcUrl = "TestUrl";
        await store.Insert(insertEmoji);
        insertEmoji.EmojiId = "123";
        insertEmoji.GuildId = "456";
        insertEmoji.Name = "TestEmoji2";
        insertEmoji.MxcUrl = "NewURL";
        await store.Update(insertEmoji);
        const getEmoji = await store.Get(DbGuildEmoji, {emoji_id: "123"});
        Chai.assert.equal(getEmoji.Name, "TestEmoji2");
        Chai.assert.equal(getEmoji.MxcUrl, "NewURL");
        Chai.assert.notEqual(getEmoji.CreatedAt, getEmoji.UpdatedAt);
    });
  });
  describe("Get|Insert|Delete<DbEvent>", () => {
    it("should insert successfully", () => {
      const store = new DiscordStore(":memory:");
      return expect(store.init().then(() => {
        const event = new DbEvent();
        event.MatrixId = "123";
        event.DiscordId = "456";
        event.GuildId = "123";
        event.ChannelId = "123";
        return store.Insert(event);
      })).to.eventually.be.fulfilled;
    });
    it("should get successfully", async () => {
        const store = new DiscordStore(":memory:");
        await store.init();
        const event = new DbEvent();
        event.MatrixId = "123";
        event.DiscordId = "456";
        event.GuildId = "123";
        event.ChannelId = "123";
        await store.Insert(event);
        const getEventDiscord = await store.Get(DbEvent, {discord_id: "456"});
        getEventDiscord.Next();
        Chai.assert.equal(getEventDiscord.MatrixId, "123");
        Chai.assert.equal(getEventDiscord.DiscordId, "456");
        Chai.assert.equal(getEventDiscord.GuildId, "123");
        Chai.assert.equal(getEventDiscord.ChannelId, "123");
        const getEventMatrix = await store.Get(DbEvent, {matrix_id: "123"});
        getEventMatrix.Next();
        Chai.assert.equal(getEventMatrix.MatrixId, "123");
        Chai.assert.equal(getEventMatrix.DiscordId, "456");
        Chai.assert.equal(getEventMatrix.GuildId, "123");
        Chai.assert.equal(getEventMatrix.ChannelId, "123");
    });
    const MSG_COUNT = 5;
    it("should get multiple discord msgs successfully", async () => {
        const store = new DiscordStore(":memory:");
        await store.init();
        for (let i = 0; i < MSG_COUNT; i++) {
            const event = new DbEvent();
            event.MatrixId = "123";
            event.DiscordId = "456" + i;
            event.GuildId = "123";
            event.ChannelId = "123";
            await store.Insert(event);
        }
        const getEventDiscord = await store.Get(DbEvent, {matrix_id: "123"});
        Chai.assert.equal(getEventDiscord.ResultCount, MSG_COUNT);
    });
    it("should get multiple matrix msgs successfully", async () => {
        const store = new DiscordStore(":memory:");
        await store.init();
        for (let i = 0; i < MSG_COUNT; i++) {
            const event = new DbEvent();
            event.MatrixId = "123" + i;
            event.DiscordId = "456";
            event.GuildId = "123";
            event.ChannelId = "123";
            await store.Insert(event);
        }
        const getEventMatrix = await store.Get(DbEvent, {discord_id: "456"});
        Chai.assert.equal(getEventMatrix.ResultCount, MSG_COUNT);
    });
    it("should not return nonexistant event", async () => {
        const store = new DiscordStore(":memory:");
        await store.init();
        const getMessage = await store.Get(DbEvent, {matrix_id: "123"});
        Chai.assert.isFalse(getMessage.Result);
    });
    it("should delete successfully", async () => {
        const store = new DiscordStore(":memory:");
        await store.init();
        const event = new DbEvent();
        event.MatrixId = "123";
        event.DiscordId = "456";
        event.GuildId = "123";
        event.ChannelId = "123";
        await store.Insert(event);
        await store.Delete(event);
        const getEvent = await store.Get(DbEvent, {matrix_id: "123"});
        getEvent.Next();
        Chai.assert.isFalse(getEvent.Result);
    });
  });
});
