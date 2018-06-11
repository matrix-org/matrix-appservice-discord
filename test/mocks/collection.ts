import { Collection } from "discord.js";

export class MockCollection<T1, T2> extends Collection<T1, T2> {
  public array(): T2[] {
    return [...this.values()];
  }

  public keyArray(): T1[] {
    return [...this.keys()];
  }
}
