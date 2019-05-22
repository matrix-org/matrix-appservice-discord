export class TimedCache<K,V> implements Map<K,V> {
    private readonly  _map: Map<K,{value: V, ts: number}>;

    public constructor(private readonly liveFor: number) {
        this._map = new Map();
    }

    clear(): void {
        this._map.clear();
    }
    
    delete(key: K): boolean {
        return this._map.delete(key);
    }

    forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void {
        throw new Error("Method not implemented.");
    }
    get(key: K): V | undefined {
        const v = this._map.get(key);
        if (v) {
            if (Date.now() - v.ts < this.liveFor) {
                return v.value;
            }
            this._map.delete(key);
        }
    }
    has(key: K): boolean {
        return this.get(key) !== undefined;
    }
    set(key: K, value: V): this {
        this._map.set(key, {
            value,
            ts: Date.now(),
        });
        return this;
    }

    public get size() : number {
        return this._map.size;
    }
    

    [Symbol.iterator](): IterableIterator<[K, V]> {
        throw new Error("Method not implemented.");
    }

    entries(): IterableIterator<[K, V]> {
        throw new Error("Method not implemented.");
    }

    keys(): IterableIterator<K> {
        throw new Error("Method not implemented.");
    }

    values(): IterableIterator<V> {
        throw new Error("Method not implemented.");
    }
    
    [Symbol.toStringTag]: string;
}