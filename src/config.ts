/** Type annotations for config/config.schema.yaml */
export class DiscordBridgeConfig {
  public bridge: DiscordBridgeConfigBridge = new DiscordBridgeConfigBridge();
  public auth: DiscordBridgeConfigAuth = new DiscordBridgeConfigAuth();
  public logging: DiscordBridgeConfigLogging = new DiscordBridgeConfigLogging();
  public database: DiscordBridgeConfigDatabase = new DiscordBridgeConfigDatabase();
  public room: DiscordBridgeConfigRoom = new DiscordBridgeConfigRoom();
  public limits: DiscordBridgeConfigLimits = new DiscordBridgeConfigLimits();
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
  public disableEveryoneMention: boolean = false;
  public disableHereMention: boolean = false;
}

class DiscordBridgeConfigDatabase {
  public filename: string;
  public userStorePath: string;
  public roomStorePath: string;
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

class DiscordBridgeConfigLimits {
  public roomGhostJoinDelay: number = 6000;
}
