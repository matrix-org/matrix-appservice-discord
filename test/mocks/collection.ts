export class MockCollection<T1, T2> extends Map {
  public array(): T2[] {
    return [...this.values()];
  }

  public keyArray(): T1[] {
    return [...this.keys()];
  }
}
