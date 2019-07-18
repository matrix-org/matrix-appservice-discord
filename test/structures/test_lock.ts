/*
Copyright 2019 matrix-appservice-discord

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

import { expect } from "chai";
import { Lock } from "../../src/structures/lock";
import { Util } from "../../src/util";

const LOCKTIMEOUT = 300;

describe("Lock", () => {
    it("should lock and unlock", async () => {
        const lock = new Lock<string>(LOCKTIMEOUT);
        const t = Date.now();
        lock.set("bunny");
        await lock.wait("bunny");
        const diff = Date.now() - t;
        expect(diff).to.be.greaterThan(LOCKTIMEOUT - 1);
    });
    it("should lock and unlock early, if unlocked", async () => {
        const SHORTDELAY = 100;
        const DELAY_ACCURACY = 5;
        const lock = new Lock<string>(LOCKTIMEOUT);
        setTimeout(() => lock.release("fox"), SHORTDELAY);
        const t = Date.now();
        lock.set("fox");
        await lock.wait("fox");
        const diff = Date.now() - t;
        // accuracy can be off by a few ms soemtimes
        expect(diff).to.be.greaterThan(SHORTDELAY - DELAY_ACCURACY);
        expect(diff).to.be.lessThan(SHORTDELAY + DELAY_ACCURACY);
    });
});
