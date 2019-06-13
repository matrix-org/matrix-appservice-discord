interface ITimedValue<V> {
    value: V;
    ts: number;
}

export class TimedCache<K, V> implements Map<K, V> {
    private readonly  map: Map<K, ITimedValue<V>>;

    public constructor(private readonly liveFor: number) {
        this.map = new Map();
    }

    public clear(): void {
        this.map.clear();
    }

    public delete(key: K): boolean {
        return this.map.delete(key);
    }

    public forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void): void {
        throw new Error("Method not implemented.");
    }

    public get(key: K): V | undefined {
        const v = this.map.get(key);
        if (v) {
            const val = this.filterV(v);
            if (val) {
                return val;
            }
            this.map.delete(key);
        }
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
                while (!item || !item.done || !filteredValue) {
                    item = iterator.next();
                    filteredValue = this.filterV(item.value[1]);
                }
                if (!item || !filteredValue) {
                    // Typscript doesn't like us returning undefined for valuel, which is dumb.
                    // tslint:disable-next-line: no-any
                    return {done: true, value: undefined} as any as IteratorResult<[K, V]>;
                }
                return {done: item.done, value: [item.value[0], filteredValue]};
            },
            // This is honestly stupid
            [Symbol.iterator]: () => this[Symbol.iterator](),
        };
    }

    public entries(): IterableIterator<[K, V]> {
        throw new Error("Method not implemented.");
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

    private filterV(v: ITimedValue<V>): V|undefined {
        if (Date.now() - v.ts < this.liveFor) {
            return v.value;
        }
    }
}
