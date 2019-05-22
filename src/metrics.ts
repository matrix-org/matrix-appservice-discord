import { PrometheusMetrics } from "matrix-appservice-bridge";
import { Gauge, Counter, Histogram } from "prom-client";
import { Log } from "./log";

const AgeCounters = PrometheusMetrics.AgeCounters;
const log = new Log("BridgeMetrics");
const REQUEST_EXPIRE_TIME_MS = 30000;

interface IAgeCounter {
    setGauge(gauge: Gauge, morelabels: any);
    bump(age: number);
}

interface IBridgeGauges {
    matrixRoomConfigs: number;
    remoteRoomConfigs: number;
    matrixGhosts: number;
    remoteGhosts: number;
    matrixRoomsByAge: IAgeCounter;
    remoteRoomsByAge: IAgeCounter;
    matrixUsersByAge: IAgeCounter;
    remoteUsersByAge: IAgeCounter;
}

export interface IBridgeMetrics {
    registerRequest(id: string);
    requestOutcome(id: string, isRemote: boolean, outcome: string);
    remoteCall(method: string);
    setPresenceCount(count: number);
    storeCall(method: string, cached: boolean);
}

export class DummyBridgeMetrics implements IBridgeMetrics {
    registerRequest() {}
    requestOutcome() {}
    remoteCall() {}
    setPresenceCount() {}
    storeCall() {}
}

export class MetricPeg {
    private static _metrics: IBridgeMetrics = new DummyBridgeMetrics();
    
    public static get get() : IBridgeMetrics {
        return this._metrics;
    }
    
    public static setMetrics(metrics: IBridgeMetrics) {
        this._metrics = metrics;
    }
}


export class PrometheusBridgeMetrics implements IBridgeMetrics {
    private metrics;
    private remoteCallCounter: Counter;
    private storeCallCounter: Counter;
    private presenceGauge: Gauge;
    private remoteRequest: Histogram;
    private matrixRequest: Histogram;
    private requestsInFlight: Map<string, number>;
    private bridgeGauges: IBridgeGauges = {
        matrixRoomConfigs: 0,
        remoteRoomConfigs: 0,
        matrixGhosts: 0,
        remoteGhosts: 0,
        matrixRoomsByAge: new AgeCounters(),
        remoteRoomsByAge: new AgeCounters(),
        matrixUsersByAge: new AgeCounters(),
        remoteUsersByAge: new AgeCounters(),
    };

    public init(bridge: any) {
        this.metrics = new PrometheusMetrics();
        this.metrics.registerMatrixSdkMetrics();
        this.metrics.registerBridgeGauges(() => this.bridgeGauges);
        this.metrics.addAppServicePath(bridge);
        this.remoteCallCounter = this.metrics.addCounter({
            name: "remote_api_calls",
            help: "Count of remote API calls made",
            labels: ["method"],
        });
        this.storeCallCounter = this.metrics.addCounter({
            name: "store_calls",
            help: "Count of store function calls made",
            labels: ["method", "cached"],
        });
        this.presenceGauge = this.metrics.addGauge({
            name: "active_presence_users",
            help: "Count of users in the presence queue",
            labels: [],
        });
        this.matrixRequest = this.metrics.addTimer({
            name: "matrix_request_seconds",
            help: "Histogram of processing durations of received Matrix messages",
            labels: ["outcome"],
        });
        this.remoteRequest = this.metrics.addTimer({
            name: "remote_request_seconds",
            help: "Histogram of processing durations of received remote messages",
            labels: ["outcome"],
        });
        this.requestsInFlight = new Map();
        setInterval(() => {
            this.requestsInFlight.forEach((time, id) => {
                if (Date.now() - time) {
                    this.requestsInFlight.delete(id);
                }
            });
        }, REQUEST_EXPIRE_TIME_MS)
        return this;
    }

    public registerRequest(id: string) {
        this.requestsInFlight.set(id, Date.now());
    }

    public requestOutcome(id: string, isRemote: boolean, outcome: string) {
        const startTime = this.requestsInFlight.get(id);
        this.requestsInFlight.delete(id);
        if (!startTime) {
            log.verbose(`Got "requestOutcome" for ${id}, but this request was never started`);
            return;
        } 
        const duration = Date.now() - startTime;
        (isRemote ? this.remoteRequest : this.matrixRequest).observe({outcome}, duration / 1000);
    }

    public setPresenceCount(count: number) {
        this.presenceGauge.set(count);
    }

    public remoteCall(method: string) {
        this.remoteCallCounter.inc({method});
    }

    public storeCall(method: string, cached: boolean) {
        this.storeCallCounter.inc({method, cached: cached ? "yes" : "no"});
    }
};

