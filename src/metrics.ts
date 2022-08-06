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
/* eslint-disable max-classes-per-file, @typescript-eslint/no-empty-function */

import { Gauge, Counter, Histogram, collectDefaultMetrics, register } from "prom-client";
import { Appservice,
    IMetricContext,
    METRIC_MATRIX_CLIENT_FAILED_FUNCTION_CALL,
    METRIC_MATRIX_CLIENT_SUCCESSFUL_FUNCTION_CALL,
    FunctionCallContext,
    METRIC_MATRIX_CLIENT_FUNCTION_CALL,
} from "matrix-bot-sdk";
import { DiscordBridgeConfigMetrics } from "./config";
import * as http from "http";

const REQUEST_EXPIRE_TIME_MS = 30000;

export interface IBridgeMetrics {
    registerRequest(id: string);
    requestOutcome(id: string, isRemote: boolean, outcome: string);
    remoteCall(method: string);
    setPresenceCount(count: number);
    storeCall(method: string, cached: boolean);
    setRemoteMonthlyActiveUsers(rmau: number);
    setBridgeBlocked(isBlocked: boolean);
    stop();
}

export class DummyBridgeMetrics implements IBridgeMetrics {
    public registerRequest() {}
    public requestOutcome() {}
    public remoteCall() {}
    public setPresenceCount() {}
    public storeCall() {}
    public setRemoteMonthlyActiveUsers() {}
    public setBridgeBlocked() {}
    public stop() {}
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
    private matrixCallCounter: Counter<string>;
    private matrixFailedCallCounter: Counter<string>;
    private remoteCallCounter: Counter<string>;
    private storeCallCounter: Counter<string>;
    private presenceGauge: Gauge<string>;
    private remoteRequest: Histogram<string>;
    private matrixRequest: Histogram<string>;
    private requestsInFlight = new Map<string, number>();
    private httpServer: http.Server;
    private remoteMonthlyActiveUsers: Gauge<string>;
    private bridgeBlocked: Gauge<string>;

    public init(as: Appservice, config: DiscordBridgeConfigMetrics) {
        collectDefaultMetrics();

        this.httpServer = http.createServer((req, res) => {
            if (req.method !== "GET" || req.url !== "/metrics") {
                res.writeHead(404, "Not found");
                res.end();
                return;
            }
            // eslint-disable-next-line @typescript-eslint/naming-convention
            res.writeHead(200, "OK", {"Content-Type": register.contentType});
            res.write(register.metrics());
            res.end();
        });

        this.matrixCallCounter = new Counter({
            help: "Count of matrix API calls made",
            labelNames: ["method", "result"],
            name: "matrix_api_calls",
        });
        this.matrixFailedCallCounter = new Counter({
            help: "Count of failed matrix API calls made",
            labelNames: ["method", "result"],
            name: "matrix_api_calls_failed",
        });
        register.registerMetric(this.matrixCallCounter);
        register.registerMetric(this.matrixFailedCallCounter);

        this.remoteCallCounter = new Counter({
            help: "Count of remote API calls made",
            labelNames: ["method"],
            name: "remote_api_calls",
        });
        register.registerMetric(this.remoteCallCounter);

        this.storeCallCounter = new Counter({
            help: "Count of store function calls made",
            labelNames: ["method", "cached"],
            name: "store_calls",
        });
        register.registerMetric(this.storeCallCounter);

        this.presenceGauge = new Gauge({
            help: "Count of users in the presence queue",
            name: "active_presence_users",
        });
        register.registerMetric(this.presenceGauge);

        this.matrixRequest = new Histogram({
            help: "Histogram of processing durations of received Matrix messages",
            labelNames: ["outcome"],
            name: "matrix_request_seconds",
        });
        register.registerMetric(this.matrixRequest);

        this.remoteRequest = new Histogram({
            help: "Histogram of processing durations of received remote messages",
            labelNames: ["outcome"],
            name: "remote_request_seconds",
        });
        register.registerMetric(this.remoteRequest);

        this.requestsInFlight = new Map();
        setInterval(() => {
            this.requestsInFlight.forEach((time, id) => {
                if (Date.now() - time) {
                    this.requestsInFlight.delete(id);
                }
            });
        }, REQUEST_EXPIRE_TIME_MS);

        this.remoteMonthlyActiveUsers = new Gauge({
            help: "Current count of remote users active this month",
            name: "bridge_remote_monthly_active_users",
        });
        register.registerMetric(this.remoteMonthlyActiveUsers);

        this.bridgeBlocked = new Gauge({
            name: "bridge_blocked",
            help: "Is the bridge currently blocking messages",
        });
        register.registerMetric(this.bridgeBlocked);

        // Bind bot-sdk metrics
        as.botClient.metrics.registerListener({
            onDecrement: this.sdkDecrementMetric.bind(this),
            onEndMetric: this.sdkEndMetric.bind(this),
            onIncrement: this.sdkIncrementMetric.bind(this),
            onReset: this.sdkResetMetric.bind(this),
            onStartMetric: this.sdkStartMetric.bind(this),
        });

        this.httpServer.listen(config.port, config.host);
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

    public setRemoteMonthlyActiveUsers(rmau: number) {
        this.remoteMonthlyActiveUsers.set(rmau);
    }

    public setBridgeBlocked(isBlocked: boolean) {
        this.bridgeBlocked.set(isBlocked ? 1 : 0);
    }

    private sdkEndMetric(metricName: string, context: FunctionCallContext, timeMs: number) {
        if (metricName !== METRIC_MATRIX_CLIENT_FUNCTION_CALL) {
            return; // We don't handle any other type yet.
        }
        const ctx = context as FunctionCallContext;
        this.matrixRequest.observe({
            method: ctx.functionName,
        }, timeMs);
    }

    private sdkIncrementMetric(metricName: string, context: IMetricContext, amount: number) {
        if (metricName === METRIC_MATRIX_CLIENT_SUCCESSFUL_FUNCTION_CALL) {
            const ctx = context as FunctionCallContext;
            this.matrixCallCounter.inc({method: ctx.functionName}, amount);
        }
        if (metricName === METRIC_MATRIX_CLIENT_FAILED_FUNCTION_CALL) {
            const ctx = context as FunctionCallContext;
            this.matrixFailedCallCounter.inc({method: ctx.functionName}, amount);
        }
    }

    private sdkResetMetric() {
        // Bot SDK doesn't use this yet.
    }

    private sdkDecrementMetric() {
        // Bot SDK doesn't use this yet.
    }

    private sdkStartMetric() {
        // We don't use this.
    }

    public stop() {
        this.httpServer.close();
    }
}
