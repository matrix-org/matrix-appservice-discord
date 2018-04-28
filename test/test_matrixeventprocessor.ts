import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import * as log from "npmlog";
import * as Discord from "discord.js";
import * as Proxyquire from "proxyquire";

// import * as Proxyquire from "proxyquire";
import { PresenceHandler } from "../src/presencehandler";
import { DiscordBot } from "../src/bot";
import { MockGuild } from "./mocks/guild";
import { MockMember } from "./mocks/member";
import {MatrixEventProcessor, MatrixEventProcessorOpts} from "../src/matrixeventprocessor";
import {DiscordBridgeConfig} from "../src/config";
import {MessageProcessor, MessageProcessorOpts} from "../src/messageprocessor";

Chai.use(ChaiAsPromised);
const expect = Chai.expect;
// const assert = Chai.assert;
const bot = {
    GetIntentFromDiscordMember: (member) => {
        return {
            getClient: () => {
                return {

                };
            },
        };
    },
};

function createMatrixEventProcessor(disableMentions: boolean = false): MatrixEventProcessor {
    const bot = {

    }
    const bridge = {

    }
    const config = new DiscordBridgeConfig();
    config.bridge.disableDiscordMentions = disableMentions;
    const messageProcessor = new MessageProcessor(new MessageProcessorOpts(
        "localhost",
        <DiscordBot> bot,
    ));
    return new MatrixEventProcessor(
        new MatrixEventProcessorOpts(
            config,
            bridge,
            messageProcessor,
    ));
}

describe("MatrixEventPrcoessor", () => {
    describe("EventToEmbed", () => {
        it("Should contain a profile.", () => {
            const processor = createMatrixEventProcessor();
            const evt = processor.EventToEmbed({
                sender: "@test:localhost",
                content: {
                    body: "testcontent",
                },
            }, {
                displayname: "Test User",
                avatar_url: "mxc://localhost/avatarurl",
            });
        });

        it("Should not contain a profile if one does not exist.", () => {

        });

        it("Should should contain the users displayname if it exists.", () => {

        });

        it("Should should contain the users userid if the displayname is not set.", () => {

        });

        it("Should should contain the users avatar if it exists.", () => {

        });

        it("Should should contain the users userid if the avatar is not set.", () => {

        });

        it("Should enable mentions if configured.", () => {

        });

        it("Should disable mentions if configured.", () => {

        });

        it("Should remove everyone mentions if configured.", () => {

        });
    });
}
