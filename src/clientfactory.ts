/*
Copyright 2017, 2018 matrix-appservice-discord

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { DiscordBridgeConfigAuth } from "./config";
import { DiscordStore } from "./store";
import { Client as DiscordClient } from "discord.js";
import * as Bluebird from "bluebird";
import { Log } from "./log";
import { Client as MatrixClient } from "matrix-js-sdk";

const log = new Log("ClientFactory");

const READY_TIMEOUT = 5000;

export class DiscordClientFactory {
    private config: DiscordBridgeConfigAuth;
    private store: DiscordStore;
    private botClient: MatrixClient;
    private clients: Map<string, MatrixClient>;
    constructor(store: DiscordStore, config?: DiscordBridgeConfigAuth) {
        this.config = config!;
        this.clients = new Map();
        this.store = store;
    }

    public async init(): Promise<void> {
        if (this.config === undefined) {
            return Promise.reject("Client config not supplied.");
        }
        // We just need to make sure we have a bearer token.
        // Create a new Bot client.
        this.botClient = Bluebird.promisifyAll(new DiscordClient({
            fetchAllMembers: true,
            messageCacheLifetime: 5,
            sync: true,
        }));

        return new Bluebird<void>((resolve, reject) => {
            this.botClient.on("ready", () => {
                resolve();
            });
            this.botClient.login(this.config.botToken).catch(reject);
        }).timeout(READY_TIMEOUT).catch((err) => {
            log.error("Could not login as the bot user. This is bad!", err);
            throw err;
        });
    }

    public async getDiscordId(token: string): Promise<string> {
        const client = new DiscordClient({
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

    public async getClient(userId: string | null = null): Promise<MatrixClient> {
        if (!userId) {
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
        const client = Bluebird.promisifyAll(new DiscordClient({
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
