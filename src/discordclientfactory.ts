import { DiscordBridgeConfigAuth } from "./config";
import { DiscordStore } from "./discordstore";
import { Client } from "discord.js";
import * as log from "npmlog";
import * as Bluebird from "bluebird";

export class DiscordClientFactory {
  private config: DiscordBridgeConfigAuth;
  private store: DiscordStore;
  private botClient: any;
  private clients: Map<string,any>;
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
    }));
    return this.botClient.login(this.config.botToken).then(() => {
      return null; // Strip token from promise.
    }).catch((err) => {
      log.error("ClientFactory", "Could not login as the bot user. This is bad!");
    })
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
        }));
        log.verbose("ClientFactory", "Got user token. Logging in...");
        return client.login(token).then(() => {
          log.verbose("ClientFactory", "Logged in. Storing ", userId);
          this.clients.set(userId, client);
          return Promise.resolve(client);
        }).catch((err) => {
          log.warn("ClientFactory", `Could not log ${userId} in.`, err);
        })
      });
      // Get from cache
    }
    return Promise.resolve(this.botClient);
  }
}
