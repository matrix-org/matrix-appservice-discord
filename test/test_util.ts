import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";

import { Util, ICommandAction, ICommandParameters } from "../src/util";

Chai.use(ChaiAsPromised);
const expect = Chai.expect;

describe("Util", () => {
	describe("MsgToArgs", () => {
		it("parses arguments", () => {
			const {command, args} = Util.MsgToArgs("!matrix command arg1 arg2", "!matrix");
			Chai.assert.equal(command, "command");
			Chai.assert.equal(args.length, 2);
			Chai.assert.equal(args[0], "arg1");
			Chai.assert.equal(args[1], "arg2");
		});
	});
	describe("ParseCommand", () => {
		it("parses commands", () => {
			const action: ICommandAction = {
				params: ["param1", "param2"],
				run: async ({param1, param2}) => {
					return `param1: ${param1}\nparam2: ${param2}`;
				},
			};
			const parameters: ICommandParameters = {
				param1: {
					get: async (param: string) => {
						return "param1_"+param;
					},
				},
				param2: {
					get: async (param: string) => {
						return "param2_"+param;
					},
				},
			};
			return Util.ParseCommand(action, parameters, ["hello", "world"]).then((retStr) => {
				expect(retStr).equal("param1: param1_hello\nparam2: param2_world");
			});
		});
	});
});
