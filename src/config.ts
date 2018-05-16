/** Type annotations for config/config.schema.yaml */

export class DiscordBridgeConfig {
  public bridge: DiscordBridgeConfigBridge = new DiscordBridgeConfigBridge();
  public auth: DiscordBridgeConfigAuth = new DiscordBridgeConfigAuth();
  public logging: DiscordBridgeConfigLogging = new DiscordBridgeConfigLogging();
  public database: DiscordBridgeConfigDatabase = new DiscordBridgeConfigDatabase();
  public room: DiscordBridgeConfigRoom = new DiscordBridgeConfigRoom();
  public channel: DiscordBridgeConfigChannel = new DiscordBridgeConfigChannel();
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
class DiscordBridgeConfigLogging {
  public level: string;
}

class DiscordBridgeConfigRoom {
  public defaultVisibility: string;
}

class DiscordBridgeConfigChannel {
  public deleteChannelOptions = new DiscordBridgeConfigChannelDeleteOptions();
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