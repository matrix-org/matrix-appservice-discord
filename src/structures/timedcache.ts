import { Log } from "../log";
const log = new Log("Timedcache");

interface ITimedValue<V> {
    value: V;
    ts: number;
}

export class TimedCache<K, V> implements Map<K, V> {
    private static unnamedCacheNameCounter: number = 0;
    private readonly map: Map<K, ITimedValue<V>>;

    public constructor(
        private readonly liveFor: number,
        private readonly cacheName: string|null = TimedCache.generateUnnamedCacheName()
    ) {
        this.map = new Map();
    }

    public clear(): void {
        this.map.clear();
    }

    /**
     * Removes invalid elements from a cache
     */
    public cleanUp(): void {
        for (const [key, value] of this.map) {
            if(this.filterV(value) === undefined) {
                this.map.delete(key);
                log.silly(`removed entry with key='${key}' from cache '${this.cacheName}'`);
            }
        }
    }

    public delete(key: K): boolean {
        return this.map.delete(key);
    }

    public forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void|Promise<void>): void {
        for (const item of this) {
            const potentialPromise = callbackfn(item[1], item[0], this);
            if (potentialPromise) {
                potentialPromise.catch(log.warn);
            }
        }
    }

    public get(key: K): V | undefined {
        const v = this.map.get(key);
        if (v === undefined) {
            return;
        }
        const val = this.filterV(v);
        if (val !== undefined) {
            return val;
        }
        // Cleanup expired key
        this.map.delete(key);
    }

    public has(key: K): boolean {
        return this.get(key) !== undefined;
    }

    public set(key: K, value: V): this {
        this.map.set(key, {
            ts: Date.now(),
            value,
        });
        return this;
    }

    public get size(): number {
        return this.map.size;
    }

    public [Symbol.iterator](): IterableIterator<[K, V]> {
        let iterator: IterableIterator<[K, ITimedValue<V>]>;
        return {
            next: () => {
                if (!iterator) {
                    iterator = this.map.entries();
                }
                let item: IteratorResult<[K, ITimedValue<V>]>|undefined;
                let filteredValue: V|undefined;
                // Loop if we have no item, or the item has expired.
                while (!item || filteredValue === undefined) {
                    item = iterator.next();
                    // No more items in map. Bye bye.
                    if (item.done) {
                        break;
                    }
                    filteredValue = this.filterV(item.value[1]);
                }
                if (item.done) {
                    // Typscript doesn't like us returning undefined for value, which is dumb.
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return {done: true, value: undefined} as any as IteratorResult<[K, V]>;
                }
                return {done: false, value: [item.value[0], filteredValue]} as IteratorResult<[K, V]>;
            },
            [Symbol.iterator]: () => this[Symbol.iterator](),
        };
    }

    public entries(): IterableIterator<[K, V]> {
        return this[Symbol.iterator]();
    }

    public keys(): IterableIterator<K> {
        throw new Error("Method not implemented.");
    }

    public values(): IterableIterator<V> {
        throw new Error("Method not implemented.");
    }

    get [Symbol.toStringTag](): "Map" {
        return "Map";
    }

    private static generateUnnamedCacheName(): string {
        const cacheName = `unnamed-cache-${TimedCache.unnamedCacheNameCounter}`;
        TimedCache.unnamedCacheNameCounter += 1;
        return cacheName;
    }

    private filterV(v: ITimedValue<V>): V|undefined {
        if (Date.now() - v.ts < this.liveFor) {
            return v.value;
        }
    }
}
