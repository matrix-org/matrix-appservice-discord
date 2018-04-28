import {MockDiscordClient} from "./discordclient";

export class DiscordClientFactory {
  constructor(config: any, store: any) {
    ;
  }

  public init(): Promise<void> {
    return Promise.resolve();
  }

  public getClient(userId?: string): Promise<MockDiscordClient> {
    return Promise.resolve(new MockDiscordClient());
  }
}
