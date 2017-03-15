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
  constructor(config: DiscordBridgeConfigAuth, store: DiscordStore) {
    this.config = config;
    this.clients = new Map();
    this.store = store;
  }

  public init(): Promise<null> {
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
    });
  }

  public getClient(userId?: string): Promise<any> {
    let client;
    if (userId) {
      if (this.clients.has(userId)) {
        log.verbose("ClientFactory", "Returning cached user client.");
        return Promise.resolve(this.clients.get(userId));
      }
      return this.store.get_user_token(userId).then((token) => {
        if (token === null) {
          return Promise.resolve(this.botClient);
        }
        client = Bluebird.promisifyAll(new Client({
          fetchAllMembers: true,
          sync: true,
          messageCacheLifetime: 5,
        }));
        log.verbose("ClientFactory", "Got user token. Logging in...");
        return client.login(token).then(() => {
          log.verbose("ClientFactory", "Logged in. Storing ", userId);
          this.clients.set(userId, client);
          return Promise.resolve(client);
        }).catch((err) => {
          log.warn("ClientFactory", `Could not log ${userId} in.`, err);
        });
      });
      // Get from cache
    }
    return Promise.resolve(this.botClient);
  }
}
