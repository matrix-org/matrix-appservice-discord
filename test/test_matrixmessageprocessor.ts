import * as Chai from "chai";
import * as Discord from "discord.js";
import { MockGuild } from "./mocks/guild";
import { MatrixMessageProcessor } from "../src/matrixmessageprocessor";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

const expect = Chai.expect;

function getPlainMessage(msg: string, msgtype: string = "m.text") {
    return {
        body: msg,
        msgtype,
    };
}

function getHtmlMessage(msg: string, msgtype: string = "m.text") {
    return {
        body: msg,
        formatted_body: msg,
        msgtype,
    };
}

describe("MatrixMessageProcessor", () => {
    describe("FormatMessage / body / simple", () => {
        it("leaves blank stuff untouched", async () => {
            const mp = new MatrixMessageProcessor();
            const guild = new MockGuild("1234");
            const msg = getPlainMessage("hello world!");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("hello world!");
        });
        it("escapes simple stuff", async () => {
            const mp = new MatrixMessageProcessor();
            const guild = new MockGuild("1234");
            const msg = getPlainMessage("hello *world* how __are__ you?");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("hello \\*world\\* how \\_\\_are\\_\\_ you?");
        });
        it("escapes more complex stuff", async () => {
            const mp = new MatrixMessageProcessor();
            const guild = new MockGuild("1234");
            const msg = getPlainMessage("wow \\*this\\* is cool");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("wow \\\\\\*this\\\\\\* is cool");
        });
    });
    describe("FormatMessage / formatted_body / simple", () => {
        it("leaves blank stuff untouched", async () => {
            const mp = new MatrixMessageProcessor();
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("hello world!");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("hello world!");
        });
        it("un-escapes simple stuff", async () => {
            const mp = new MatrixMessageProcessor();
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("foxes &amp; foxes");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("foxes & foxes");
        });
        it("converts italic formatting", async () => {
            const mp = new MatrixMessageProcessor();
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("this text is <em>italic</em> and so is <i>this one</i>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("this text is *italic* and so is *this one*");
        });
        it("converts bold formatting", async () => {
            const mp = new MatrixMessageProcessor();
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("wow some <b>bold</b> and <strong>more</strong> boldness!");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("wow some **bold** and **more** boldness!");
        });
        it("converts underline formatting", async () => {
            const mp = new MatrixMessageProcessor();
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("to be <u>underlined</u> or not to be?");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("to be __underlined__ or not to be?");
        });
        it("converts strike formatting", async () => {
            const mp = new MatrixMessageProcessor();
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("does <del>this text</del> exist?");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("does ~~this text~~ exist?");
        });
        it("converts code", async () => {
            const mp = new MatrixMessageProcessor();
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("WOW this is <code>some awesome</code> code");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("WOW this is `some awesome` code");
        });
        it("converts multiline-code", async () => {
            const mp = new MatrixMessageProcessor();
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<p>here</p><pre><code>is\ncode\n</code></pre><p>yay</p>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("here```\nis\ncode\n```\nyay");
        });
        it("converts multiline language code", async () => {
            const mp = new MatrixMessageProcessor();
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<p>here</p><pre><code class=\"language-js\">is\ncode\n</code></pre><p>yay</p>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("here```js\nis\ncode\n```\nyay");
        });
    });
    describe("FormatMessage / formatted_body / complex", () => {
        it("html unescapes stuff inside of code", async () => {
            const mp = new MatrixMessageProcessor();
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<code>is &lt;em&gt;italic&lt;/em&gt;?</code>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("`is <em>italic</em>?`");
        });
        it("html unescapes inside of pre", async () => {
            const mp = new MatrixMessageProcessor();
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<pre><code>wow &amp;</code></pre>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("```\nwow &```\n");
        });
        it("doesn't parse inside of code", async () => {
            const mp = new MatrixMessageProcessor();
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<code>*yay*</code>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("`*yay*`");
        });
        it("doesn't parse inside of pre", async () => {
            const mp = new MatrixMessageProcessor();
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<pre><code>*yay*</code></pre>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("```\n*yay*```\n");
        });
    });
});
