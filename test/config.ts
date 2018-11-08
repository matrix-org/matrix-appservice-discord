import {argv} from "process";
import {Log} from "../src/log";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count */

if (!argv.includes("--noisy")) {
    Log.ForceSilent();
}
