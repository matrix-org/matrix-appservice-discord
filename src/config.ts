/*
Copyright 2017 - 2019 matrix-appservice-discord

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/** Type annotations for config/config.schema.yaml */
export class DiscordBridgeConfig {
    public bridge: DiscordBridgeConfigBridge = new DiscordBridgeConfigBridge();
    public auth: DiscordBridgeConfigAuth = new DiscordBridgeConfigAuth();
    public logging: DiscordBridgeConfigLogging = new DiscordBridgeConfigLogging();
    public database: DiscordBridgeConfigDatabase = new DiscordBridgeConfigDatabase();
    public room: DiscordBridgeConfigRoom = new DiscordBridgeConfigRoom();
    public channel: DiscordBridgeConfigChannel = new DiscordBridgeConfigChannel();
    public limits: DiscordBridgeConfigLimits = new DiscordBridgeConfigLimits();
    public ghosts: DiscordBridgeConfigGhosts = new DiscordBridgeConfigGhosts();

    /**
     * Apply a set of keys and values over the default config.
     * @param _config Config keys
     * @param configLayer Private parameter
     */
    // tslint:disable-next-line no-any
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
    public disableReadReceipts: boolean;
    public disableEveryoneMention: boolean = false;
    public disableHereMention: boolean = false;
    public disableJoinLeaveNotifications: boolean = false;
}

export class DiscordBridgeConfigDatabase {
    public connString: string;
    public filename: string;
    public userStorePath: string;
    public roomStorePath: string;
}

export class DiscordBridgeConfigAuth {
    public clientID: string;
    public botToken: string;
}

export class DiscordBridgeConfigLogging {
    public console: string = "info";
    public lineDateFormat: string = "MMM-D HH:mm:ss.SSS";
    public files: LoggingFile[] = [];
}

class DiscordBridgeConfigRoom {
    public defaultVisibility: string;
    public kickFor: number = 30000;
}

class DiscordBridgeConfigChannel {
    public namePattern: string = "[Discord] :guild :name";
    public deleteOptions = new DiscordBridgeConfigChannelDeleteOptions();
}

class DiscordBridgeConfigChannelDeleteOptions {
    public namePrefix: string | null = null;
    public topicPrefix: string | null = null;
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

class DiscordBridgeConfigGhosts {
    public nickPattern: string = ":nick";
    public usernamePattern: string = ":username#:tag";
}
