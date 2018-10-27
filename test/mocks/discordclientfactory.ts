import {MockDiscordClient} from "./discordclient";

export class DiscordClientFactory {
    private botClient: MockDiscordClient = null;
    constructor(config: any, store: any) {

    }

    public init(): Promise<void> {
      return Promise.resolve();
    }

    public getClient(userId?: string): Promise<MockDiscordClient> {
        if (userId == null && !this.botClient) {
            this.botClient = new MockDiscordClient();
        }
        return Promise.resolve(this.botClient);
    }
}
