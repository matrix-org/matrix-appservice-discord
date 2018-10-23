import {argv} from "process";
import {Log} from "../src/log";

if (!argv.includes("--noisy")) {
    Log.ForceSilent();
}
