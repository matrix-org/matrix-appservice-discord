/** Type annotations for config/config.schema.yaml */

export class DiscordBridgeConfig {
  public bridge: DiscordBridgeConfigBridge;
  public auth: DiscordBridgeConfigAuth;
  public guilds: DiscordBridgeConfigGuilds[];
}

class DiscordBridgeConfigBridge {
  public domain: string;
  public homeserverUrl: string;
}

class DiscordBridgeConfigAuth {
  public clientID: string;
  public secret: string;
  public botToken: string;
}

class DiscordBridgeConfigGuilds {
  public id: string;
  public aliasName: string;
}
