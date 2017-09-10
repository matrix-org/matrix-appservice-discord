import { DiscordStore } from "../../store";
export interface IDbSchema {
  description: string;
  run(store: DiscordStore): Promise<null>;
  rollBack(store: DiscordStore): Promise<null>;
}
