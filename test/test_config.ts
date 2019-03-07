/*
Copyright 2018 matrix-appservice-discord

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

import * as Chai from "chai";
import { DiscordBridgeConfig } from "../src/config";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

const expect = Chai.expect;

describe("DiscordBridgeConfig.ApplyConfig", () => {
    it("should merge configs correctly", () => {
        const config = new DiscordBridgeConfig();
        config.ApplyConfig({
            bridge: {
                disableDeletionForwarding: true,
                disableDiscordMentions: false,
                disableTypingNotifications: true,
                enableSelfServiceBridging: false,
                disableJoinLeaveNotifications: true,
                homeserverUrl: "blah",
            },
            logging: {
                console: "warn",
            },
        });
        expect(config.bridge.homeserverUrl, "blah");
        expect(config.bridge.disableTypingNotifications).to.be.true;
        expect(config.bridge.disableDiscordMentions).to.be.false;
        expect(config.bridge.disableDeletionForwarding).to.be.true;
        expect(config.bridge.enableSelfServiceBridging).to.be.false;
        expect(config.brdge.disableJoinLeaveNotifications).to.be.true
        expect(config.logging.console, "warn");
    });
    it("should merge logging.files correctly", () => {
        const config = new DiscordBridgeConfig();
        config.ApplyConfig({
            logging: {
                console: "silent",
                files: [
                    {
                        file: "./bacon.log",
                    },
                ],
            },
        });
        expect(config.logging.files[0].file, "./bacon.log");
    });
});
