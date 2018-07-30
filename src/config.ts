/** Type annotations for config/config.schema.yaml */
export class DiscordBridgeConfig {
  public bridge: DiscordBridgeConfigBridge = new DiscordBridgeConfigBridge();
  public auth: DiscordBridgeConfigAuth = new DiscordBridgeConfigAuth();
  public logging: DiscordBridgeConfigLogging = new DiscordBridgeConfigLogging();
  public database: DiscordBridgeConfigDatabase = new DiscordBridgeConfigDatabase();
  public room: DiscordBridgeConfigRoom = new DiscordBridgeConfigRoom();
  public limits: DiscordBridgeConfigLimits = new DiscordBridgeConfigLimits();

  /**
   * Apply a set of keys and values over the default config.
   * @param _config Config keys
   * @param configLayer Private parameter
   */
  public ApplyConfig(newConfig: {[key: string]: any}, configLayer: any = this) {
    Object.keys(newConfig).forEach((key) => {
      if (typeof(configLayer[key]) === "object")  {
        this.ApplyConfig(newConfig[key], this[key]);
        return;
      }
      configLayer[key] = newConfig[key];
    });
  }
}

class DiscordBridgeConfigBridge {
  public domain: string;
  public homeserverUrl: string;
  public presenceInterval: number = 500;
  public disablePresence: boolean;
  public disableTypingNotifications: boolean;
  public disableDiscordMentions: boolean;
  public disableTabCompletionMentions: boolean;
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
