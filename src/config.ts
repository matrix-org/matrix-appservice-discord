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

class DiscordBridgeConfigLimits {
  public roomGhostJoinDelay: number = 6000;
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
