import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isGlobalInstallLifecycle,
  runPostinstall,
} from "../postinstall.js";

describe("isGlobalInstallLifecycle", () => {
  it("accepts npm_config_global=true", () => {
    assert.equal(isGlobalInstallLifecycle({ npm_config_global: "true" }), true);
  });

  it("accepts npm_config_location=global", () => {
    assert.equal(isGlobalInstallLifecycle({ npm_config_location: "global" }), true);
  });

  it("rejects local installs", () => {
    assert.equal(isGlobalInstallLifecycle({ npm_config_global: "false" }), false);
  });
});

describe("runPostinstall", () => {
  it("prints an explicit opt-in setup hint without writing files for global installs", async () => {
    const logs: string[] = [];
    const result = await runPostinstall({
      env: { npm_config_global: "true" },
      getCurrentVersion: async () => "0.14.1",
      log: (message) => logs.push(message),
    });

    assert.deepEqual(result, { status: "hinted", version: "0.14.1" });
    assert.match(logs.join("\n"), /Installed NOMX v0\.14\.1/);
    assert.match(logs.join("\n"), /Setup is explicit opt-in; run `nomx setup`/);
  });

  it("skips local installs", async () => {
    const result = await runPostinstall({
      env: { npm_config_global: "false" },
      getCurrentVersion: async () => "0.14.1",
    });

    assert.equal(result.status, "noop-local");
  });
});
