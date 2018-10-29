import {MockDiscordClient} from "./discordclient";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

export class DiscordClientFactory {
    private botClient: MockDiscordClient;
    constructor(config: any, store: any) { }

    public async init(): Promise<void> { }

    public async getClient(userId?: string): Promise<MockDiscordClient> {
        if (!userId && !this.botClient) {
            this.botClient = new MockDiscordClient();
        }
        return this.botClient;
    }
}
