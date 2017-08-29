import {MockDiscordClient} from "./discordclient";

export class DiscordClientFactory {
  public static sentMessages: Array<any> = [];
  public static sentWebhookMessages: Array<any> = [];
  constructor(config: any, store: any) {
      DiscordClientFactory.sentMessages = [];
      DiscordClientFactory.sentWebhookMessages = [];
  }

  public init(): Promise<null> {
    return Promise.resolve();
  }

  public getClient(userId?: string): Promise<MockDiscordClient> {
    return Promise.resolve(new MockDiscordClient());
  }
}

