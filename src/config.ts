/** Type annotations for config/config.schema.yaml */
export class DiscordBridgeConfig {
  public bridge: DiscordBridgeConfigBridge = new DiscordBridgeConfigBridge();
  public auth: DiscordBridgeConfigAuth = new DiscordBridgeConfigAuth();
  public logging: DiscordBridgeConfigLogging = new DiscordBridgeConfigLogging();
  public database: DiscordBridgeConfigDatabase = new DiscordBridgeConfigDatabase();
  public room: DiscordBridgeConfigRoom = new DiscordBridgeConfigRoom();
  public channel: DiscordBridgeConfigChannel = new DiscordBridgeConfigChannel();
  public limits: DiscordBridgeConfigLimits = new DiscordBridgeConfigLimits();

  /**
   * Apply a set of keys and values over the default config.
   * @param _config Config keys
   * @param configLayer Private parameter
   */
  public ApplyConfig(newConfig: {[key: string]: any}, configLayer: any = this) {
    Object.keys(newConfig).forEach((key) => {
      if ( typeof(configLayer[key]) === "object" &&
           !Array.isArray(configLayer[key])) {
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
  public disableDeletionForwarding: boolean;
  public enableSelfServiceBridging: boolean;
  public disableEveryoneMention: boolean = false;
  public disableHereMention: boolean = false;
}

export class DiscordBridgeConfigDatabase {
  public connString: string;
  public filename: string;
  public userStorePath: string;
  public roomStorePath: string;
}

export class DiscordBridgeConfigAuth {
  public clientID: string;
  public secret: string;
  public botToken: string;
}

export class DiscordBridgeConfigLogging {
  public console: string = "info";
  public lineDateFormat: string = "MMM-D HH:mm:ss.SSS";
  public files: LoggingFile[] = [];
}

class DiscordBridgeConfigRoom {
  public defaultVisibility: string;
}

class DiscordBridgeConfigChannel {
  public namePattern: string = "[Discord] :guild :name";
  public deleteOptions = new DiscordBridgeConfigChannelDeleteOptions();
}

class DiscordBridgeConfigChannelDeleteOptions {
  public namePrefix: string = null;
  public topicPrefix: string = null;
  public disableMessaging: boolean = false;
  public unsetRoomAlias: boolean = true;
  public unlistFromDirectory: boolean = true;
  public setInviteOnly: boolean = true;
  public ghostsLeave: boolean = true;
}

class DiscordBridgeConfigLimits {
  public roomGhostJoinDelay: number = 6000;
  public discordSendDelay: number = 750;
}

export class LoggingFile {
  public file: string;
  public level: string = "info";
  public maxFiles: string = "14d";
  public maxSize: string|number = "50m";
  public datePattern: string = "YYYY-MM-DD";
  public enabled: string[] = [];
  public disabled: string[] = [];
}
