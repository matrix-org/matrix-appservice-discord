/*
Copyright 2017, 2018 matrix-appservice-discord

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

import { Collection } from "@mx-puppet/better-discord.js";

export class MockCollection<T1, T2> extends Collection<T1, T2> {
    public array(): T2[] {
        return [...this.values()];
    }

    public keyArray(): T1[] {
        return [...this.keys()];
    }
}

export class MockCollectionManager<T1, T2> {
    private innerCache = new MockCollection<T1, T2>();
    public get cache() {
        return this.innerCache;
    }

    public updateCache(c: MockCollection<T1, T2>) {
        this.innerCache = c;
    }

    public resolve(id: T1) {
        return this.innerCache.get(id);
    }

    public async fetch(id: T1) {
        return this.innerCache.get(id);
    }
}
