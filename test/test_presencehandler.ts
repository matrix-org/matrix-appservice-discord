/*
Copyright 2017, 2018 matrix-appservice-discord

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
import * as Discord from "discord.js";

import { PresenceHandler } from "../src/presencehandler";
import { DiscordBot } from "../src/bot";
import { MockUser } from "./mocks/user";
import { AppserviceMock } from "./mocks/appservicemock";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

const INTERVAL = 250;
let lastStatus = null;
const appservice = new AppserviceMock();
const bot: any = {
    GetBotId: () => {
        return "1234";
    },
    GetIntentFromDiscordMember: (member: MockUser) => {
        return appservice.getIntentForSuffix(member.id);
    },
};

describe("PresenceHandler", () => {
    describe("init", () => {
        it("constructor", () => {
            const handler = new PresenceHandler(bot as DiscordBot);
        });
    });
    describe("Stop", () => {
        it("should start and stop without errors", async () => {
            const handler = new PresenceHandler(bot as DiscordBot);
            await handler.Start(INTERVAL);
            handler.Stop();
        });
    });
    describe("EnqueueUser", () => {
        it("adds a user properly", () => {
            const handler = new PresenceHandler(bot as DiscordBot);
            const COUNT = 2;
            handler.EnqueueUser(new MockUser("abc", "def") as any);
            handler.EnqueueUser(new MockUser("123", "ghi") as any);
            expect(handler.QueueCount).to.be.equal(COUNT);
        });
        it("does not add duplicate users", () => {
            const handler = new PresenceHandler(bot as DiscordBot);
            handler.EnqueueUser(new MockUser("abc", "def") as any);
            handler.EnqueueUser(new MockUser("abc", "def") as any);
            expect(handler.QueueCount).to.be.equal(1);
        });
        it("does not add the bot user", () => {
            const handler = new PresenceHandler(bot as DiscordBot);
            handler.EnqueueUser(new MockUser("1234", "def") as any);
            expect(handler.QueueCount).to.be.equal(0);
        });
    });
    describe("DequeueUser", () => {
        it("removes users properly", () => {
            const handler = new PresenceHandler(bot as DiscordBot);
            const members = [
                new MockUser("abc", "def") as any,
                new MockUser("def", "ghi") as any,
                new MockUser("ghi", "wew") as any,
            ];
            handler.EnqueueUser(members[0]);
            handler.EnqueueUser(members[1]);
            handler.EnqueueUser(members[members.length - 1]);

            handler.DequeueUser(members[members.length - 1]);
            expect(handler.QueueCount).to.be.equal(members.length - 1);
            handler.DequeueUser(members[1]);
            expect(handler.QueueCount).to.be.equal(1);
            handler.DequeueUser(members[0]);
            expect(handler.QueueCount).to.be.equal(0);
        });
    });
    describe("ProcessUser", () => {
        it("processes an online user", async () => {
            lastStatus = null;
            const handler = new PresenceHandler(bot as DiscordBot);
            const member = new MockUser("abc", "def") as any;
            member.MockSetPresence(new Discord.Presence({
                status: "online",
            }, {} as any));
            await handler.ProcessUser(member);
            appservice.getIntentForSuffix(member.id)
                .underlyingClient.wasCalled("setPresenceStatus", true, "online", undefined);
        });
        it("processes an offline user", async () => {
            lastStatus = null;
            const handler = new PresenceHandler(bot as DiscordBot);
            const member = new MockUser("abc", "def") as any;
            member.MockSetPresence(new Discord.Presence({
                status: "offline",
            }, {} as any));
            await handler.ProcessUser(member);
            appservice.getIntentForSuffix(member.id)
                .underlyingClient.wasCalled("setPresenceStatus", true, "offline", undefined);
        });
        it("processes an idle user", async () => {
            lastStatus = null;
            const handler = new PresenceHandler(bot as DiscordBot);
            const member = new MockUser("abc", "def") as any;
            member.MockSetPresence(new Discord.Presence({
                status: "idle",
            }, {} as any));
            await handler.ProcessUser(member);
            appservice.getIntentForSuffix(member.id)
                .underlyingClient.wasCalled("setPresenceStatus", true, "unavailable", undefined);
        });
        it("processes an dnd user", async () => {
            lastStatus = null;
            const handler = new PresenceHandler(bot as DiscordBot);
            const member = new MockUser("abc", "def") as any;
            member.MockSetPresence(new Discord.Presence({
                status: "dnd",
            }, {} as any));
            await handler.ProcessUser(member);
            appservice.getIntentForSuffix(member.id)
                .underlyingClient.wasCalled("setPresenceStatus", true, "online", "Do not disturb");
            member.MockSetPresence(new Discord.Presence({
                game: new Discord.Game({name: "Test Game"}, {} as any),
                status: "dnd",
            }, {} as any));
            await handler.ProcessUser(member);
            appservice.getIntentForSuffix(member.id)
                .underlyingClient.wasCalled("setPresenceStatus", true, "online", "Do not disturb | Playing Test Game");
        });
        it("processes a user playing games", async () => {
            lastStatus = null;
            const handler = new PresenceHandler(bot as DiscordBot);
            const member = new MockUser("abc", "def") as any;
            member.MockSetPresence(new Discord.Presence({
                game: new Discord.Game({name: "Test Game"}, {} as any),
                status: "online",
            }, {} as any));
            await handler.ProcessUser(member);
            appservice.getIntentForSuffix(member.id)
                .underlyingClient.wasCalled("setPresenceStatus", true, "online", "Playing Test Game");
            member.MockSetPresence(new Discord.Presence({
                game: new Discord.Game({name: "Test Game", type: 1}, {} as any),
                status: "online",
            }, {} as any));
            await handler.ProcessUser(member);
            appservice.getIntentForSuffix(member.id)
                .underlyingClient.wasCalled("setPresenceStatus", true, "online", "Streaming Test Game");
        });
    });
});
