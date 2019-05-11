import { IMatrixEvent } from "../../src/matrixtypes";

/* tslint:disable:no-unused-expression no-any */

interface IAppserviceMockOpts {
    roommembers?: IMatrixEvent[];
}

class AppserviceMockBase {
    private calls: {[key: string]: [any[]]} = {};

    public wasCalled(funcName: string, ...args: any[]): number {
        const called = this.calls[funcName];
        if (!called) {
            return 0;
        } else if (args.length === 0) {
            return called.length;
        }
        return called.filter((callArgs) =>
            args.every((v, i) => callArgs[i] === v),
        ).length;
    }

    protected funcCalled(funcName: string, ...args: any[]) {
        this.calls[funcName] = this.calls[funcName] || [];
        this.calls[funcName].push(args);
    }
}

export class AppserviceMock extends AppserviceMockBase {
    public botIntent: IntentMock = this.getIntentForUserId();
    constructor(private opts: IAppserviceMockOpts = {}) {
        super();
        opts.roommembers = opts.roommembers || [];
    }

    public getIntentForUserId(userId?: string) {
        this.funcCalled("getIntent", userId);
        return new IntentMock(this.opts);
    }
}

class IntentMock extends AppserviceMockBase {

    constructor(private opts: IAppserviceMockOpts = {}) {
        super();
    }

    public getClient() {
        this.funcCalled("getClient");
        return new ClassMock();
    }

    public ban() {
        this.funcCalled("ban");
    }

    public join() {
        this.funcCalled("join");
    }

    public joinRoom() {
        this.funcCalled("joinRoom");
    }

    public kick() {
        this.funcCalled("kick");
    }

    public leave() {
        this.funcCalled("leave");
    }

    public sendMessage() {
        this.funcCalled("sendMessage");
    }

    public unban() {
        this.funcCalled("unban");
    }
}

class ClassMock extends AppserviceMockBase {

    constructor(private opts: IAppserviceMockOpts = {}) {
        super();
    }

    public getRoomMembers(roomId: string) {
        this.funcCalled("getRoomMembers", roomId);
        return {
            chunk: this.opts.roommembers!,
        };
    }

    public leaveRoom(roomId: string) {
        this.funcCalled("leaveRoom", roomId);
    }

    public sendStateEvent(roomId: string) {
        this.funcCalled("sendStateEvent", roomId);
    }
    
    public setAvatarUrl(avatarUrl: string) {
        this.funcCalled("setAvatarUrl", avatarUrl);
    }

    public setDisplayName(displayName: string) {
        this.funcCalled("setDisplayName", displayName);
    }

    public getRoomStateEvent (roomId: string) {
        this.funcCalled("getRoomStateEvent", roomId);
    }
}
