import { argv } from "process";
import { Log } from "../src/log";
import * as WhyRunning from "why-is-node-running";

const logger = new Log("MessageProcessor");

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count */

if (!argv.includes("--noisy")) {
    Log.ForceSilent();
}

after(() => {
    WhyRunning();
});
