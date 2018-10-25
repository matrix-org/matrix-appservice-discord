import * as yaml from "js-yaml";
import * as Chai from "chai";
import { ConfigValidator } from "matrix-appservice-bridge";

const expect = Chai.expect;

describe("ConfigSchema", () => {
    const validator = new ConfigValidator("./config/config.schema.yaml");
    it("should successfully validate a minimal config", () => {
        const yamlConfig = yaml.safeLoad(`
            bridge:
                domain: localhost
                homeserverUrl: "http://localhost:8008"
            auth:
                clientID: foo
                botToken: foobar`);
        validator.validate(yamlConfig);
    });
    it("should successfully validate the sample config", () => {
         validator.validate("./config/config.sample.yaml");
    });
});
