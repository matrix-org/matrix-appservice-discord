import {Client} from "discord.js";
import { DiscordBridgeConfig } from "./config";
import * as log from "npmlog";

// Response expected by the bridge.
export type ThirdPartyLocationResult = {
alias: string,
protocol: string,
fields: {
    guild_id: string,
    channel_name: string,
    channel_id: string,
}
};

export class ThirdpartyHandler {
    constructor(private bot: Client, private config: DiscordBridgeConfig) {

    }

    public SearchChannels(guildId: string, searchString: string): ThirdPartyLocationResult[] {
        if (searchString.startsWith("#")) {
            searchString = searchString.substr(1);
        }

        if (this.bot.guilds.has(guildId) ) {
            const guild = this.bot.guilds.get(guildId);
            return guild.channels.filter((channel) => {
                return channel.name.toLowerCase() === searchString.toLowerCase(); // Implement searching in the future.
            }).map((channel) => {
                return {
                    alias: `#_discord_${guild.id}_${channel.id}:${this.config.bridge.domain}`,
                    protocol: "discord",
                    fields: {
                        guild_id: guild.id,
                        channel_name: channel.name,
                        channel_id: channel.id,
                    },
                };
            });
        } else {
            log.info("ThirdpartyHandler", "Tried to do a third party lookup for a channel, but the guild did not exist");
            return [];
        }
    }
}
