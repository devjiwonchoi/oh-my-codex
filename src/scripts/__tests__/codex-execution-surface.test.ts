import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { resolveCodexExecutionSurface } from "../codex-execution-surface.js";

describe("resolveCodexExecutionSurface", () => {
  it("classifies explicit App and shell sources as native and direct", () => {
    assert.deepEqual(resolveCodexExecutionSurface("/tmp", {
      payload: { source: "codex-app" },
    }), { launcher: "native" });
    assert.deepEqual(resolveCodexExecutionSurface("/tmp", {
      payload: { source: "shell" },
    }), { launcher: "direct" });
  });

  it("recognizes a persisted native session without exposing tmux transport taxonomy", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nomx-execution-surface-"));
    const previousTmux = process.env.TMUX;
    try {
      await mkdir(join(cwd, ".nomx", "state"), { recursive: true });
      await writeFile(join(cwd, ".nomx", "state", "session.json"), JSON.stringify({
        native_session_id: "native-session",
      }));
      process.env.TMUX = "/tmp/tmux-test";

      assert.deepEqual(resolveCodexExecutionSurface(cwd, {
        payload: { session_id: "native-session" },
      }), { launcher: "native" });
    } finally {
      if (previousTmux === undefined) delete process.env.TMUX;
      else process.env.TMUX = previousTmux;
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
