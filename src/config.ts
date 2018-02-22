/** Type annotations for config/config.schema.yaml */

export class DiscordBridgeConfig {
  public bridge: DiscordBridgeConfigBridge;
  public auth: DiscordBridgeConfigAuth;
  public logging: DiscordBridgeConfigLogging;
  public database: DiscordBridgeConfigDatabase;
  public room: DiscordBridgeConfigRoom;
}

class DiscordBridgeConfigBridge {
  public domain: string;
  public homeserverUrl: string;
  public presenceInterval: number = 500;
  public disablePresence: boolean;
  public disableTypingNotifications: boolean;
  public disableDiscordMentions: boolean;
  public disableDeletionForwarding: boolean;
  public enableSelfServiceBridging: boolean;
}

class DiscordBridgeConfigDatabase {
  public filename: string;
}

export class DiscordBridgeConfigAuth {
  public clientID: string;
  public secret: string;
  public botToken: string;
}
class DiscordBridgeConfigLogging {
  public level: string;
}

class DiscordBridgeConfigRoom {
  public defaultVisibility: string;
}
