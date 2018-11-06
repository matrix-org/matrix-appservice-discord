import { Collection } from "discord.js";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

export class MockCollection<T1, T2> extends Collection<T1, T2> {
    public array(): T2[] {
        return [...this.values()];
    }

    public keyArray(): T1[] {
        return [...this.keys()];
    }
}
