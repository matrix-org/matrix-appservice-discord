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

import { PrometheusMetrics, Bridge } from "matrix-appservice-bridge";
import { Gauge, Counter, Histogram } from "prom-client";
import { Log } from "./log";

const AgeCounters = PrometheusMetrics.AgeCounters;
const log = new Log("BridgeMetrics");
const REQUEST_EXPIRE_TIME_MS = 30000;

interface IAgeCounter {
    setGauge(gauge: Gauge, morelabels: string[]);
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
    public registerRequest() {}
    public requestOutcome() {}
    public remoteCall() {}
    public setPresenceCount() {}
    public storeCall() {}
}

export class MetricPeg {
    public static get get(): IBridgeMetrics {
        return this.metrics;
    }

    public static set(metrics: IBridgeMetrics) {
        this.metrics = metrics;
    }

    private static metrics: IBridgeMetrics = new DummyBridgeMetrics();
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
        matrixGhosts: 0,
        matrixRoomConfigs: 0,
        matrixRoomsByAge: new AgeCounters(),
        matrixUsersByAge: new AgeCounters(),
        remoteGhosts: 0,
        remoteRoomConfigs: 0,
        remoteRoomsByAge: new AgeCounters(),
        remoteUsersByAge: new AgeCounters(),
    };

    public init(bridge: Bridge) {
        this.metrics = new PrometheusMetrics();
        this.metrics.registerMatrixSdkMetrics();
        this.metrics.registerBridgeGauges(() => this.bridgeGauges);
        this.metrics.addAppServicePath(bridge);
        this.remoteCallCounter = this.metrics.addCounter({
            help: "Count of remote API calls made",
            labels: ["method"],
            name: "remote_api_calls",
        });
        this.storeCallCounter = this.metrics.addCounter({
            help: "Count of store function calls made",
            labels: ["method", "cached"],
            name: "store_calls",
        });
        this.presenceGauge = this.metrics.addGauge({
            help: "Count of users in the presence queue",
            labels: [],

            name: "active_presence_users",
        });
        this.matrixRequest = this.metrics.addTimer({
            help: "Histogram of processing durations of received Matrix messages",
            labels: ["outcome"],
            name: "matrix_request_seconds",
        });
        this.remoteRequest = this.metrics.addTimer({
            help: "Histogram of processing durations of received remote messages",
            labels: ["outcome"],
            name: "remote_request_seconds",
        });
        this.requestsInFlight = new Map();
        setInterval(() => {
            this.requestsInFlight.forEach((time, id) => {
                if (Date.now() - time) {
                    this.requestsInFlight.delete(id);
                }
            });
        }, REQUEST_EXPIRE_TIME_MS);
        return this;
    }

    public registerRequest(id: string) {
        this.requestsInFlight.set(id, Date.now());
    }

    public requestOutcome(id: string, isRemote: boolean, outcome: string) {
        const startTime = this.requestsInFlight.get(id);
        if (!startTime) {
            return;
        }
        this.requestsInFlight.delete(id);
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
}
