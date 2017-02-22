import { DiscordStore } from "../discordstore";
export interface IDbSchema {
  description: string,
  run(store: DiscordStore): Promise<null>;
}
