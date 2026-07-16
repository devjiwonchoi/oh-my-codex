import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { auditNomxIdentity } from "../audit-nomx-identity.js";

const manifest = {
  schema_version: 1,
  entries: [{
    token: "<!-- OMX:RUNTIME:START -->",
    kind: "managed_marker",
    file_patterns: ["templates/AGENTS.md"],
    rationale: "stable overlay boundary",
    removal_policy: "versioned migration",
    schema_version: 1,
  }],
};

describe("NOMX identity audit", () => {
  it("allows declared stable ABI tokens and legacy compatibility fixtures", async () => {
    const root = await mkdtemp(join(tmpdir(), "nomx-audit-pass-"));
    try {
      await mkdir(join(root, "templates"), { recursive: true });
      await mkdir(join(root, "src", "compat", "legacy-omx"), { recursive: true });
      await writeFile(join(root, "templates", "AGENTS.md"), "<!-- OMX:RUNTIME:START -->\nNOMX\n");
      await writeFile(join(root, "src", "compat", "legacy-omx", "fixture.ts"), "export const root = '.omx';\n");
      assert.deepEqual(await auditNomxIdentity({ root, manifest }), []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects legacy product, root, environment, and MCP identities", async () => {
    const root = await mkdtemp(join(tmpdir(), "nomx-audit-fail-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(
        join(root, "src", "bad.ts"),
        [
          "const product = 'oh-my-codex';",
          "const root = '.omx';",
          "const env = process.env.OMX_ROOT;",
          "const tool = 'omx_state';",
        ].join("\n"),
      );
      const findings = await auditNomxIdentity({ root, manifest });
      assert.deepEqual(new Set(findings.map((finding) => finding.code)), new Set([
        "legacy_product_identity",
        "legacy_runtime_root",
        "legacy_environment",
        "legacy_mcp_id",
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
