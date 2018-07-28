import { DiscordStore } from "../../store";
export interface IDbSchema {
  description: string;
  run(store: DiscordStore): Promise<null|void|Error|Error[]>;
  rollBack(store: DiscordStore): Promise<null|void|Error|Error[]>;
}
