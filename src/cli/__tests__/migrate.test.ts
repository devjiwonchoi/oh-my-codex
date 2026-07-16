import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { NamespaceError, nominalRootPair, resolveNomxAuthority } from "../../identity/index.js";
import {
  claimMigrationHandoff,
  createMigrationHandoff,
  inventoryMigrationRoot,
  migrateRoot,
  rollbackMigration,
  runMigrationHandoff,
} from "../migrate-core.js";

const ARTIFACT_DIGEST = "a".repeat(64);

async function fixture(): Promise<{ project: string; pair: ReturnType<typeof nominalRootPair> }> {
  const project = await mkdtemp(join(tmpdir(), "nomx-migrate-"));
  const pair = nominalRootPair(project);
  await mkdir(join(pair.legacyRoot, "state", "sessions"), { recursive: true });
  await mkdir(join(pair.legacyRoot, "logs"), { recursive: true });
  await writeFile(join(pair.legacyRoot, "state", "sessions", "one.json"), "session-bytes\n");
  await writeFile(join(pair.legacyRoot, "logs", "events.jsonl"), "{\"event\":1}\n");
  await chmod(join(pair.legacyRoot, "state", "sessions", "one.json"), 0o640);
  return { project, pair };
}

describe("NOMX root migration", () => {
  it("dry-runs without writes, migrates byte-for-byte, and is idempotent", async () => {
    const { pair } = await fixture();
    const before = await inventoryMigrationRoot(pair.legacyRoot);
    const dryRun = await migrateRoot({ pair, dryRun: true });
    assert.equal(dryRun.result, "dry_run");
    assert.equal(existsSync(pair.canonicalRoot), false);
    assert.equal(existsSync(`${pair.canonicalRoot}.migration-journal.json`), false);

    const migrated = await migrateRoot({ pair, artifactSha256: ARTIFACT_DIGEST });
    assert.equal(migrated.result, "migrated");
    assert.equal(await readFile(join(pair.canonicalRoot, "state", "sessions", "one.json"), "utf8"), "session-bytes\n");
    assert.equal((await stat(join(pair.canonicalRoot, "state", "sessions", "one.json"))).mode & 0o777, 0o640);
    assert.equal(migrated.inventoryDigest, before.digest);
    assert.equal((await resolveNomxAuthority(pair)).state, "dual_root_complete");

    const rerun = await migrateRoot({ pair, artifactSha256: ARTIFACT_DIGEST });
    assert.equal(rerun.result, "noop");
  });

  it("refuses active writers and symlinks without creating canonical state", async () => {
    const active = await fixture();
    await assert.rejects(
      migrateRoot({ pair: active.pair, artifactSha256: ARTIFACT_DIGEST, dependencies: { activeWriters: async () => ["session:test"] } }),
      (error: unknown) => error instanceof NamespaceError && error.code === "migration_active_writers",
    );
    assert.equal(existsSync(active.pair.canonicalRoot), false);

    const linked = await fixture();
    await symlink(join(linked.pair.legacyRoot, "state"), join(linked.pair.legacyRoot, "linked-state"));
    await assert.rejects(
      migrateRoot({ pair: linked.pair, artifactSha256: ARTIFACT_DIGEST }),
      (error: unknown) => error instanceof NamespaceError && error.code === "migration_source_invalid",
    );
    assert.equal(existsSync(linked.pair.canonicalRoot), false);
  });

  it("recovers after interruption at every durable forward phase", async () => {
    for (const interruptedPhase of ["copied", "verified", "complete"] as const) {
      const { pair } = await fixture();
      let interrupted = false;
      await assert.rejects(migrateRoot({
        pair,
        artifactSha256: ARTIFACT_DIGEST,
        dependencies: {
          beforeTransition: (phase) => {
            if (!interrupted && phase === interruptedPhase) {
              interrupted = true;
              throw new Error(`crash:${phase}`);
            }
          },
        },
      }), new RegExp(`crash:${interruptedPhase}`));
      const resumed = await migrateRoot({ pair, artifactSha256: ARTIFACT_DIGEST });
      assert.equal(resumed.result, "migrated");
      assert.equal((await resolveNomxAuthority(pair)).state, "dual_root_complete");
    }
  });

  it("rolls activated state back without deleting either retained copy", async () => {
    const { pair } = await fixture();
    const migrated = await migrateRoot({ pair, artifactSha256: ARTIFACT_DIGEST });
    const rolledBack = await rollbackMigration(migrated.journalPath);
    assert.equal(rolledBack.result, "rolled_back");
    assert.equal(existsSync(pair.legacyRoot), true);
    assert.equal(existsSync(pair.canonicalRoot), false);
    assert.equal((await resolveNomxAuthority(pair)).state, "legacy_only");
    assert.equal((await rollbackMigration(migrated.journalPath)).result, "rolled_back");
  });
});

describe("post-Stop migration handoff", () => {
  it("creates mode-0600 handoffs, consumes once, and rejects replay", async () => {
    const { project, pair } = await fixture();
    const artifact = join(project, "nomx.tgz");
    const pending = join(project, "handoff.pending.json");
    await writeFile(artifact, "proven artifact");
    const created = await createMigrationHandoff({
      path: pending,
      pair,
      artifactPath: artifact,
      initiatingSessionId: "session-1",
      initiatingTaskId: "task-1",
    });
    assert.equal((await stat(pending)).mode & 0o777, 0o600);
    const consumed = await runMigrationHandoff(pending, created.token);
    assert.equal(consumed.record.status, "consumed");
    assert.equal(consumed.migration.result, "migrated");
    await assert.rejects(
      claimMigrationHandoff(pending, created.token),
      (error: unknown) => error instanceof NamespaceError && error.code === "migration_handoff_replayed",
    );
  });

  it("rejects an expired, mistokened, or artifact-tampered handoff before migration writes", async () => {
    for (const mode of ["expired", "token", "artifact"] as const) {
      const { project, pair } = await fixture();
      const artifact = join(project, `${mode}.tgz`);
      const pending = join(project, `${mode}.pending.json`);
      await writeFile(artifact, "proven artifact");
      const created = await createMigrationHandoff({
        path: pending,
        pair,
        artifactPath: artifact,
        initiatingSessionId: "session-1",
        initiatingTaskId: "task-1",
        ...(mode === "expired" ? { ttlMs: 1, now: new Date("2026-01-01T00:00:00.000Z") } : {}),
      });
      if (mode === "artifact") await writeFile(artifact, "replacement artifact");
      const token = mode === "token" ? "wrong" : created.token;
      await assert.rejects(
        claimMigrationHandoff(pending, token, mode === "expired" ? { now: new Date("2026-01-01T00:00:01.000Z") } : {}),
        (error: unknown) => error instanceof NamespaceError && ["migration_handoff_expired", "migration_handoff_tampered"].includes(error.code),
      );
      assert.equal(existsSync(pair.canonicalRoot), false);
    }
  });
});
