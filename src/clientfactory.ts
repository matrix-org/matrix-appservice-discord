import { DiscordBridgeConfigAuth } from "./config";
import { DiscordStore } from "./store";
import { Client } from "discord.js";
import * as log from "npmlog";
import * as Bluebird from "bluebird";

const READY_TIMEOUT = 5000;

export class DiscordClientFactory {
  private config: DiscordBridgeConfigAuth;
  private store: DiscordStore;
  private botClient: any;
  private clients: Map<string, any>;
  constructor(store: DiscordStore, config?: DiscordBridgeConfigAuth) {
    this.config = config;
    this.clients = new Map();
    this.store = store;
  }

  public init(): Promise<null> {
    if (this.config === undefined) {
      return Promise.reject("Client config not supplied.");
    }
    // We just need to make sure we have a bearer token.
    // Create a new Bot client.
    this.botClient = Bluebird.promisifyAll(new Client({
      fetchAllMembers: true,
      sync: true,
      messageCacheLifetime: 5,
    }));
    this.botClient.login(this.config.botToken);
    return this.botClient.onAsync("ready")
    .timeout(READY_TIMEOUT, "Bot timed out waiting for ready.")
    .catch((err) => {
      log.error("ClientFactory", "Could not login as the bot user. This is bad!", err);
      throw err;
    });
  }

 public getDiscordId(token: String): Bluebird<string> {
    const client: any = new Client({
      fetchAllMembers: false,
      sync: false,
      messageCacheLifetime: 5,
    });
    return new Bluebird<string>((resolve, reject) => {
      client.login(token).catch(reject);
      client.on("ready", () => {
        const id = client.user.id;
        client.destroy();
        resolve(id);
      });
    }).timeout(READY_TIMEOUT).catch((err: Error) => {
      log.warn("ClientFactory", "Could not login as a normal user. '%s'", err.message);
      throw Error("Could not retrive ID");
    });
  }

  public async getClient(userId: string = null): Promise<any> {
    if (userId == null) {
      return this.botClient;
    }
    if (this.clients.has(userId)) {
      log.verbose("ClientFactory", "Returning cached user client for %s.", userId);
      return this.clients.get(userId);
    }
    const discordIds = await this.store.get_user_discord_ids(userId);
    if (discordIds.length === 0) {
      return Promise.resolve(this.botClient);
    }
    // TODO: Select a profile based on preference, not the first one.
    const token = await this.store.get_token(discordIds[0]);
    const client: any = Bluebird.promisifyAll(new Client({
      fetchAllMembers: true,
      sync: true,
      messageCacheLifetime: 5,
    }));
    try {
      await client.login(token);
      log.verbose("ClientFactory", "Logged in. Storing ", userId);
      this.clients.set(userId, client);
      return client;
    } catch (err) {
      log.warn("ClientFactory", `Could not log ${userId} in.`, err);
    }
  }
}
