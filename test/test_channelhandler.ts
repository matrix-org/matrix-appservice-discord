import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import * as log from "npmlog";
import * as Discord from "discord.js";
import * as Proxyquire from "proxyquire";

import { ChannelHandler } from "../src/channelhandler";
import { DiscordBot } from "../src/bot";
import { MockGuild } from "./mocks/guild";
import { MockMember } from "./mocks/member";
import {MatrixEventProcessor, MatrixEventProcessorOpts} from "../src/matrixeventprocessor";
import {DiscordBridgeConfig} from "../src/config";
import {MessageProcessor, MessageProcessorOpts} from "../src/messageprocessor";
import {MockChannel} from "./mocks/channel";

Chai.use(ChaiAsPromised);
const expect = Chai.expect;

const bot = {

};

const bridge = {

};

const config = new DiscordBridgeConfig();

describe("ChannelHandler", () => {
    describe("HandleChannelDelete", () => {
        it("will not delete non-text channels" () => {

        });
    });
    describe("GetRoomIdsFromChannel", () => {

    });
    describe("HandleChannelDelete", () => {

    });
});
