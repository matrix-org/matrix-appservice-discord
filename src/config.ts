/** Type annotations for config/config.schema.yaml */

export class DiscordBridgeConfig {
  public bridge: DiscordBridgeConfigBridge;
  public auth: DiscordBridgeConfigAuth;
  public logging: DiscordBridgeConfigLogging;
}

class DiscordBridgeConfigBridge {
  public domain: string;
  public homeserverUrl: string;
}

export class DiscordBridgeConfigAuth {
  public clientID: string;
  public secret: string;
  public botToken: string;
}
class DiscordBridgeConfigLogging {
  public level: string;
}
