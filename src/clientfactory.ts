import { DiscordBridgeConfigAuth } from "./config";
import { DiscordStore } from "./store";
import { Client } from "discord.js";
import * as Bluebird from "bluebird";
import { Log } from "./log";

const log = new Log("ClientFactory");

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

    public async init(): Promise<void> {
        if (this.config === undefined) {
            return Promise.reject("Client config not supplied.");
        }
        // We just need to make sure we have a bearer token.
        // Create a new Bot client.
        this.botClient = Bluebird.promisifyAll(new Client({
            fetchAllMembers: true,
            messageCacheLifetime: 5,
            sync: true,
        }));
        return Bluebird.all([
            this.botClient.onAsync("ready").timeout(READY_TIMEOUT, "Bot timed out waiting for ready."),
            this.botClient.login(this.config.botToken),
        ]).then(() => { return; }).catch((err) => {
            log.error("Could not login as the bot user. This is bad!", err);
            throw err;
        });
    }

    public async getDiscordId(token: string): Promise<string> {
        const client = new Client({
            fetchAllMembers: false,
            messageCacheLifetime: 5,
            sync: false,
        });
        return new Bluebird<string>((resolve, reject) => {
            client.on("ready", async () => {
                const id = client.user.id;
                await client.destroy();
                resolve(id);
            });
            client.login(token).catch(reject);
        }).timeout(READY_TIMEOUT).catch((err: Error) => {
            log.warn("Could not login as a normal user.", err.message);
            throw Error("Could not retrieve ID");
        });
    }

    public async getClient(userId: string = null): Promise<any> {
        if (userId == null) {
            return this.botClient;
        }
        if (this.clients.has(userId)) {
            log.verbose("Returning cached user client for", userId);
            return this.clients.get(userId);
        }
        const discordIds = await this.store.get_user_discord_ids(userId);
        if (discordIds.length === 0) {
            return Promise.resolve(this.botClient);
        }
        // TODO: Select a profile based on preference, not the first one.
        const token = await this.store.get_token(discordIds[0]);
        const client = Bluebird.promisifyAll(new Client({
            fetchAllMembers: true,
            messageCacheLifetime: 5,
            sync: true,
        }));
        const jsLog = new Log("discord.js-ppt");
        client.on("debug", (msg) => { jsLog.verbose(msg); });
        client.on("error", (msg) => { jsLog.error(msg); });
        client.on("warn", (msg) => { jsLog.warn(msg); });
        try {
            await client.login(token);
            log.verbose("Logged in. Storing ", userId);
            this.clients.set(userId, client);
            return client;
        } catch (err) {
            log.warn(`Could not log ${userId} in. Returning bot user for now.`, err);
            return this.botClient;
        }
    }
}
