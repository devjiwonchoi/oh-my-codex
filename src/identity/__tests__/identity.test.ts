import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  NOMX_IDENTITY,
  LEGACY_OMX_IDENTITY,
  NamespaceError,
  createNomxRootMetadata,
  nominalRootPair,
  resolveNamespaceEnvironment,
  resolveNamespacePath,
  resolveNomxAuthority,
} from "../index.js";

describe("NOMX identity", () => {
  it("keeps canonical and read-only legacy identities separate", () => {
    assert.equal(NOMX_IDENTITY.projectDirectoryName, ".nomx");
    assert.equal(NOMX_IDENTITY.environmentPrefix, "NOMX_");
    assert.equal(LEGACY_OMX_IDENTITY.projectDirectoryName, ".omx");
    assert.equal(LEGACY_OMX_IDENTITY.environmentPrefix, "OMX_");
  });

  it("prefers canonical environment values, accepts equivalent aliases, and rejects conflicts", async () => {
    const base = await mkdtemp(join(tmpdir(), "nomx-env-"));
    const actual = join(base, "actual");
    const alias = join(base, "alias");
    await mkdir(actual);
    await symlink(actual, alias);
    assert.deepEqual(resolveNamespacePath("ROOT", { NOMX_ROOT: `${actual}/`, OMX_ROOT: alias }, base), {
      suffix: "ROOT",
      source: "nomx",
      value: await realpath(actual),
      canonicalName: "NOMX_ROOT",
      legacyName: "OMX_ROOT",
    });
    assert.equal(resolveNamespaceEnvironment({ suffix: "AUTO_UPDATE", kind: "boolean" }, { OMX_AUTO_UPDATE: "yes" }).value, true);
    assert.throws(
      () => resolveNamespacePath("ROOT", { NOMX_ROOT: actual, OMX_ROOT: join(base, "other") }, base),
      (error: unknown) => error instanceof NamespaceError && error.code === "namespace_env_conflict",
    );
    assert.equal(resolveNamespacePath("ROOT", { NOMX_ROOT: "   " }, base).source, "absent");
  });
});

describe("NOMX authority", () => {
  it("does not create a canonical root when only legacy state exists", async () => {
    const project = await mkdtemp(join(tmpdir(), "nomx-authority-"));
    const pair = nominalRootPair(project);
    assert.equal((await resolveNomxAuthority(pair)).state, "fresh_nomx");
    await mkdir(pair.legacyRoot);
    const decision = await resolveNomxAuthority(pair);
    assert.equal(decision.state, "legacy_only");
    assert.equal(decision.writable, false);
    assert.equal(decision.errorCode, "migration_required");
  });

  it("requires valid metadata before a NOMX-only root becomes writable", async () => {
    const project = await mkdtemp(join(tmpdir(), "nomx-authority-"));
    const pair = nominalRootPair(project);
    await mkdir(pair.canonicalRoot);
    assert.equal((await resolveNomxAuthority(pair)).state, "metadata_invalid");
    await writeFile(join(pair.canonicalRoot, "identity.json"), JSON.stringify(createNomxRootMetadata(pair.canonicalRoot)));
    const decision = await resolveNomxAuthority(pair);
    assert.equal(decision.state, "nomx_only");
    assert.equal(decision.writable, true);
  });
});
