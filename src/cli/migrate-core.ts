import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, lstat, mkdir, open, readFile, readdir, rename, stat, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  NOMX_IDENTITY,
  NamespaceError,
  canonicalizeNamespacePath,
  createNomxRootMetadata,
  resolveNomxAuthority,
  validateCompletedMigrationRecord,
  validateNomxRootMetadata,
  type NomxCompletedMigrationRecord,
  type NomxRootPair,
} from "../identity/index.js";

export type MigrationPhase = "preparing" | "copied" | "verified" | "complete" | "rolling_back" | "rolled_back";

export interface MigrationInventoryEntry {
  path: string;
  kind: "directory" | "file";
  mode: number;
  size: number;
  sha256?: string;
  treatment: "stable" | "mutable";
}

export interface MigrationInventory {
  schema_version: 1;
  source_root: string;
  entries: MigrationInventoryEntry[];
  digest: string;
  symlink_policy: "reject";
}

export interface NomxMigrationJournal {
  schema_name: typeof NOMX_IDENTITY.migrationSchemaName;
  schema_version: typeof NOMX_IDENTITY.migrationSchemaVersion;
  operation_id: string;
  journal_generation: number;
  journal_nonce: string;
  phase: MigrationPhase;
  source_root: string;
  destination_root: string;
  staging_root: string;
  backup_root: string;
  artifact_sha256: string;
  inventory: MigrationInventory;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  rollback_archive?: string;
  observability_log?: string;
}

export interface MigrationEvent {
  schema_version: 1;
  event: string;
  timestamp: string;
  operation_id: string;
  journal_generation: number;
  handoff_nonce_hash: string | null;
  authority_state: string;
  source_root: string;
  destination_root: string;
  artifact_digest: string;
  phase: string;
  result: "started" | "passed" | "failed" | "refused" | "noop";
  error_code: string | null;
}

export interface MigrationResult {
  operationId: string;
  result: "migrated" | "noop" | "dry_run" | "rolled_back";
  authorityState: string;
  sourceRoot: string;
  destinationRoot: string;
  journalPath: string;
  backupRoot?: string;
  inventoryDigest?: string;
}

export interface MigrateDependencies {
  now?: () => Date;
  operationId?: () => string;
  activeWriters?: (pair: NomxRootPair) => Promise<string[]>;
  beforeTransition?: (phase: MigrationPhase, journal: NomxMigrationJournal) => Promise<void> | void;
}

export interface MigrateOptions {
  pair: NomxRootPair;
  dryRun?: boolean;
  artifactPath?: string;
  artifactSha256?: string;
  logPath?: string;
  handoffNonceHash?: string;
  dependencies?: MigrateDependencies;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(path: string): Promise<string> {
  return sha256(await readFile(path));
}

async function fsyncPath(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicWriteJson(path: string, value: unknown, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temporaryPath, "wx", mode);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, path);
  await fsyncPath(dirname(path));
}

async function appendEvent(path: string | undefined, event: MigrationEvent): Promise<void> {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "a", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(event)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function eventFor(
  event: string,
  result: MigrationEvent["result"],
  pair: NomxRootPair,
  values: {
    operationId: string;
    generation?: number;
    nonceHash?: string;
    authority?: string;
    artifact?: string;
    phase?: string;
    errorCode?: string;
    now: Date;
  },
): MigrationEvent {
  return {
    schema_version: 1,
    event,
    timestamp: values.now.toISOString(),
    operation_id: values.operationId,
    journal_generation: values.generation ?? 0,
    handoff_nonce_hash: values.nonceHash ?? null,
    authority_state: values.authority ?? "unknown",
    source_root: resolve(pair.legacyRoot),
    destination_root: resolve(pair.canonicalRoot),
    artifact_digest: values.artifact ?? "",
    phase: values.phase ?? "planning",
    result,
    error_code: values.errorCode ?? null,
  };
}

function isMutablePath(relativePath: string): boolean {
  return /(^|\/)(logs?|events?|traces?)(\/|$)/i.test(relativePath) || /\.jsonl$/i.test(relativePath);
}

export async function inventoryMigrationRoot(root: string): Promise<MigrationInventory> {
  const resolvedRoot = resolve(root);
  const rootStats = await lstat(resolvedRoot).catch(() => null);
  if (!rootStats?.isDirectory() || rootStats.isSymbolicLink()) {
    throw new NamespaceError("migration_source_invalid", `Migration source must be a non-symlink directory: ${resolvedRoot}`);
  }
  const entries: MigrationInventoryEntry[] = [];
  const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const absolutePath = join(directory, child.name);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${child.name}` : child.name;
      const details = await lstat(absolutePath);
      if (details.isSymbolicLink()) {
        throw new NamespaceError("migration_source_invalid", `Symlinked migration content is rejected: ${relativePath}`);
      }
      if (details.isDirectory()) {
        entries.push({ path: relativePath, kind: "directory", mode: details.mode & 0o7777, size: 0, treatment: "stable" });
        await visit(absolutePath, relativePath);
      } else if (details.isFile()) {
        entries.push({
          path: relativePath,
          kind: "file",
          mode: details.mode & 0o7777,
          size: details.size,
          sha256: await sha256File(absolutePath),
          treatment: isMutablePath(relativePath) ? "mutable" : "stable",
        });
      } else {
        throw new NamespaceError("migration_source_invalid", `Unsupported migration entry type: ${relativePath}`);
      }
    }
  };
  await visit(resolvedRoot, "");
  const payload = JSON.stringify(entries);
  return { schema_version: 1, source_root: resolvedRoot, entries, digest: sha256(payload), symlink_policy: "reject" };
}

async function verifyCopiedInventory(root: string, expected: MigrationInventory): Promise<void> {
  const actual = await inventoryMigrationRoot(root);
  if (actual.digest !== expected.digest) {
    throw new NamespaceError("migration_verification_failed", `Copied inventory digest mismatch: expected ${expected.digest}, received ${actual.digest}`);
  }
}

async function resolveArtifactDigest(options: MigrateOptions): Promise<string> {
  if (options.artifactSha256) {
    if (!SHA256_PATTERN.test(options.artifactSha256)) throw new NamespaceError("migration_verification_failed", "artifactSha256 must be a lowercase SHA-256 digest");
    return options.artifactSha256;
  }
  if (options.artifactPath) return sha256File(resolve(options.artifactPath));
  if (options.dryRun) return "";
  throw new NamespaceError("migration_verification_failed", "Real migration requires a proven --artifact path or artifact SHA-256");
}

function processIsLive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function collectLiveWriterPids(value: unknown, source: string, writers: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectLiveWriterPids(entry, source, writers));
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(record)) {
    if (/(^|_)(pid|process_id)$/i.test(key) && typeof entry === "number" && processIsLive(entry)) {
      writers.push(`${source}:${key}:${entry}`);
    } else if (entry && typeof entry === "object") {
      collectLiveWriterPids(entry, source, writers);
    }
  }
}

async function defaultActiveWriters(pair: NomxRootPair): Promise<string[]> {
  const stateRoot = join(pair.legacyRoot, "state");
  if (!existsSync(stateRoot)) return [];
  const writers: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      const path = join(directory, child.name);
      if (child.isDirectory()) {
        await visit(path);
      } else if (child.isFile() && child.name.endsWith(".json")) {
        const parsed = await readFile(path, "utf8").then((raw) => JSON.parse(raw) as unknown).catch(() => null);
        collectLiveWriterPids(parsed, path.slice(stateRoot.length + 1), writers);
      }
    }
  };
  await visit(stateRoot);
  return [...new Set(writers)].sort();
}

async function readJournal(path: string): Promise<NomxMigrationJournal | null> {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(await readFile(path, "utf8")) as NomxMigrationJournal;
  if (parsed.schema_name !== NOMX_IDENTITY.migrationSchemaName || parsed.schema_version !== 1) {
    throw new NamespaceError("namespace_migration_conflict", `Unsupported migration journal: ${path}`);
  }
  return parsed;
}

function assertJournalMatches(journal: NomxMigrationJournal, pair: NomxRootPair, artifactDigest: string): void {
  if (journal.source_root !== resolve(pair.legacyRoot)
    || journal.destination_root !== resolve(pair.canonicalRoot)
    || journal.artifact_sha256 !== artifactDigest) {
    throw new NamespaceError("namespace_migration_conflict", "Existing migration journal does not match the requested roots and artifact");
  }
}

async function transitionJournal(
  journalPath: string,
  journal: NomxMigrationJournal,
  phase: MigrationPhase,
  now: Date,
  dependencies: MigrateDependencies,
): Promise<NomxMigrationJournal> {
  const next = {
    ...journal,
    phase,
    journal_generation: journal.journal_generation + 1,
    updated_at: now.toISOString(),
    ...(phase === "complete" ? { completed_at: now.toISOString() } : {}),
  };
  await dependencies.beforeTransition?.(phase, next);
  await atomicWriteJson(journalPath, next);
  return next;
}

async function acquireLease(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
    await atomicWriteJson(join(path, "owner.json"), { pid: process.pid, acquired_at: new Date().toISOString() });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new NamespaceError("migration_lease_held", `Migration lease is already held: ${path}`);
    }
    throw error;
  }
}

async function releaseLease(path: string): Promise<void> {
  const releasedPath = `${path}.released-${randomUUID()}`;
  await rename(path, releasedPath).catch(() => undefined);
  const { rm } = await import("node:fs/promises");
  await rm(releasedPath, { recursive: true, force: true });
}

export async function migrateRoot(options: MigrateOptions): Promise<MigrationResult> {
  const dependencies = options.dependencies ?? {};
  const now = dependencies.now ?? (() => new Date());
  const operationId = dependencies.operationId?.() ?? randomUUID();
  const pair = {
    projectRoot: canonicalizeNamespacePath(options.pair.projectRoot),
    legacyRoot: canonicalizeNamespacePath(options.pair.legacyRoot),
    canonicalRoot: canonicalizeNamespacePath(options.pair.canonicalRoot),
  };
  const journalPath = `${pair.canonicalRoot}.migration-journal.json`;
  const leasePath = `${pair.canonicalRoot}.migration-lease`;
  const artifactDigest = await resolveArtifactDigest(options);
  const authority = await resolveNomxAuthority(pair);
  await appendEvent(options.logPath, eventFor("authority_decision", "passed", pair, {
    operationId, authority: authority.state, artifact: artifactDigest, now: now(), nonceHash: options.handoffNonceHash,
  }));
  if (artifactDigest) {
    await appendEvent(options.logPath, eventFor("artifact_verification", "passed", pair, {
      operationId, authority: authority.state, artifact: artifactDigest, now: now(), nonceHash: options.handoffNonceHash,
    }));
  }

  if (authority.state === "nomx_only" || authority.state === "dual_root_complete") {
    return { operationId, result: "noop", authorityState: authority.state, sourceRoot: pair.legacyRoot, destinationRoot: pair.canonicalRoot, journalPath };
  }
  if (authority.state === "fresh_nomx") {
    return { operationId, result: options.dryRun ? "dry_run" : "noop", authorityState: authority.state, sourceRoot: pair.legacyRoot, destinationRoot: pair.canonicalRoot, journalPath };
  }
  if (!["legacy_only", "migration_preparing", "migration_copied", "migration_verified"].includes(authority.state)) {
    throw new NamespaceError(authority.errorCode ?? "namespace_migration_conflict", `Migration refused while authority is ${authority.state}`);
  }

  const inventory = await inventoryMigrationRoot(pair.legacyRoot);
  if (options.dryRun) {
    return {
      operationId, result: "dry_run", authorityState: authority.state, sourceRoot: pair.legacyRoot,
      destinationRoot: pair.canonicalRoot, journalPath, inventoryDigest: inventory.digest,
    };
  }

  const activeWriters = await (dependencies.activeWriters ?? defaultActiveWriters)(pair);
  if (activeWriters.length > 0) {
    await appendEvent(options.logPath, eventFor("lease_refusal", "refused", pair, {
      operationId, authority: authority.state, artifact: artifactDigest, now: now(), errorCode: "migration_active_writers",
    }));
    throw new NamespaceError("migration_active_writers", `Migration requires quiescence; active writers: ${activeWriters.join(", ")}`);
  }

  await acquireLease(leasePath);
  await appendEvent(options.logPath, eventFor("lease_acquire", "passed", pair, {
    operationId, authority: authority.state, artifact: artifactDigest, now: now(),
  }));
  try {
    let journal = await readJournal(journalPath);
    if (journal) {
      assertJournalMatches(journal, pair, artifactDigest);
      if (journal.inventory.digest !== inventory.digest) {
        throw new NamespaceError("namespace_migration_conflict", "Legacy source changed after migration journal creation");
      }
    } else {
      const stamp = now().toISOString().replace(/[:.]/g, "-");
      journal = {
        schema_name: NOMX_IDENTITY.migrationSchemaName,
        schema_version: NOMX_IDENTITY.migrationSchemaVersion,
        operation_id: operationId,
        journal_generation: 1,
        journal_nonce: randomUUID(),
        phase: "preparing",
        source_root: pair.legacyRoot,
        destination_root: pair.canonicalRoot,
        staging_root: `${pair.canonicalRoot}.staging-${operationId}`,
        backup_root: `${pair.legacyRoot}.backup-${stamp}`,
        artifact_sha256: artifactDigest,
        inventory,
        created_at: now().toISOString(),
        updated_at: now().toISOString(),
        ...(options.logPath ? { observability_log: resolve(options.logPath) } : {}),
      };
      await dependencies.beforeTransition?.("preparing", journal);
      await atomicWriteJson(journalPath, journal);
    }

    if (journal.phase === "preparing") {
      if (!existsSync(journal.backup_root)) {
        await cp(pair.legacyRoot, journal.backup_root, { recursive: true, preserveTimestamps: true, errorOnExist: true });
      }
      if (!existsSync(journal.staging_root)) {
        await cp(pair.legacyRoot, journal.staging_root, { recursive: true, preserveTimestamps: true, errorOnExist: true });
      }
      journal = await transitionJournal(journalPath, journal, "copied", now(), dependencies);
      await appendEvent(options.logPath, eventFor("journal_transition", "passed", pair, {
        operationId: journal.operation_id, generation: journal.journal_generation, artifact: artifactDigest, phase: journal.phase, now: now(),
      }));
    }
    if (journal.phase === "copied") {
      await verifyCopiedInventory(journal.staging_root, journal.inventory);
      journal = await transitionJournal(journalPath, journal, "verified", now(), dependencies);
      await appendEvent(options.logPath, eventFor("inventory_verification", "passed", pair, {
        operationId: journal.operation_id, generation: journal.journal_generation, artifact: artifactDigest, phase: journal.phase, now: now(),
      }));
    }
    if (journal.phase === "verified") {
      if (!existsSync(pair.canonicalRoot)) {
        const sourceStats = await stat(pair.legacyRoot);
        const stagingStats = await stat(journal.staging_root);
        const metadata = createNomxRootMetadata(pair.canonicalRoot, now());
        const record: NomxCompletedMigrationRecord = {
          schema_name: NOMX_IDENTITY.migrationSchemaName,
          schema_version: NOMX_IDENTITY.migrationSchemaVersion,
          source_legacy_root: pair.legacyRoot,
          source_legacy_identity: sha256(`${pair.legacyRoot}:${sourceStats.dev}:${sourceStats.ino}`),
          destination_root_uuid: metadata.root_uuid,
          destination_root: pair.canonicalRoot,
          inventory_digest: journal.inventory.digest,
          artifact_sha256: artifactDigest,
          journal_generation: journal.journal_generation + 1,
          journal_nonce: journal.journal_nonce,
          permissions: { mode: sourceStats.mode & 0o7777, uid: sourceStats.uid, gid: sourceStats.gid },
          device: { source_dev: sourceStats.dev, destination_dev: stagingStats.dev },
          phase: "complete",
          completed_at: now().toISOString(),
          verification: { result: "passed", verified_at: now().toISOString() },
        };
        validateNomxRootMetadata(metadata, pair.canonicalRoot);
        validateCompletedMigrationRecord(record, metadata, pair.legacyRoot, pair.canonicalRoot);
        await atomicWriteJson(join(journal.staging_root, "identity.json"), metadata);
        await atomicWriteJson(join(journal.staging_root, "migration.json"), record);
        await rename(journal.staging_root, pair.canonicalRoot);
        await fsyncPath(dirname(pair.canonicalRoot));
      }
      journal = await transitionJournal(journalPath, journal, "complete", now(), dependencies);
      await appendEvent(options.logPath, eventFor("journal_transition", "passed", pair, {
        operationId: journal.operation_id, generation: journal.journal_generation, authority: "dual_root_complete",
        artifact: artifactDigest, phase: journal.phase, now: now(),
      }));
    }

    const finalAuthority = await resolveNomxAuthority(pair);
    if (!finalAuthority.writable || finalAuthority.state !== "dual_root_complete") {
      throw new NamespaceError("migration_verification_failed", `Post-activation authority verification failed: ${finalAuthority.state}`);
    }
    return {
      operationId: journal.operation_id,
      result: "migrated",
      authorityState: finalAuthority.state,
      sourceRoot: pair.legacyRoot,
      destinationRoot: pair.canonicalRoot,
      journalPath,
      backupRoot: journal.backup_root,
      inventoryDigest: journal.inventory.digest,
    };
  } finally {
    await releaseLease(leasePath);
  }
}

export async function rollbackMigration(journalPath: string, dependencies: MigrateDependencies = {}): Promise<MigrationResult> {
  const now = dependencies.now ?? (() => new Date());
  let journal = await readJournal(resolve(journalPath));
  if (!journal) throw new NamespaceError("namespace_migration_conflict", `Migration journal not found: ${journalPath}`);
  const pair: NomxRootPair = {
    projectRoot: dirname(journal.destination_root),
    legacyRoot: journal.source_root,
    canonicalRoot: journal.destination_root,
  };
  const leasePath = `${pair.canonicalRoot}.migration-lease`;
  await acquireLease(leasePath);
  try {
    if (journal.phase === "rolled_back") {
      return { operationId: journal.operation_id, result: "rolled_back", authorityState: "legacy_only", sourceRoot: pair.legacyRoot, destinationRoot: pair.canonicalRoot, journalPath: resolve(journalPath), backupRoot: journal.backup_root };
    }
    await appendEvent(journal.observability_log, eventFor("rollback_start", "started", pair, {
      operationId: journal.operation_id, generation: journal.journal_generation, artifact: journal.artifact_sha256, phase: journal.phase, now: now(),
    }));
    journal = await transitionJournal(resolve(journalPath), journal, "rolling_back", now(), dependencies);
    if (existsSync(pair.canonicalRoot)) {
      const archive = `${pair.canonicalRoot}.rollback-${now().toISOString().replace(/[:.]/g, "-")}`;
      await rename(pair.canonicalRoot, archive);
      journal.rollback_archive = archive;
      await fsyncPath(dirname(pair.canonicalRoot));
    }
    journal = await transitionJournal(resolve(journalPath), journal, "rolled_back", now(), dependencies);
    await appendEvent(journal.observability_log, eventFor("rollback_complete", "passed", pair, {
      operationId: journal.operation_id, generation: journal.journal_generation, authority: "legacy_only", artifact: journal.artifact_sha256, phase: journal.phase, now: now(),
    }));
    return { operationId: journal.operation_id, result: "rolled_back", authorityState: "legacy_only", sourceRoot: pair.legacyRoot, destinationRoot: pair.canonicalRoot, journalPath: resolve(journalPath), backupRoot: journal.backup_root };
  } finally {
    await releaseLease(leasePath);
  }
}

export interface MigrationHandoffRecord {
  schema_name: typeof NOMX_IDENTITY.handoffSchemaName;
  schema_version: typeof NOMX_IDENTITY.handoffSchemaVersion;
  nonce: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  initiating_session_id: string;
  initiating_task_id: string;
  initiating_session_lease?: string;
  artifact_path: string;
  artifact_sha256: string;
  expected_source_root: string;
  expected_destination_root: string;
  migration_arguments: string[];
  verification_command: string[];
  rollback_command: string[];
  status: "pending" | "claimed" | "consumed" | "failed";
  claimed_at?: string;
  completed_at?: string;
  error_code?: string;
}

export interface CreateHandoffOptions {
  path: string;
  pair: NomxRootPair;
  artifactPath: string;
  initiatingSessionId: string;
  initiatingTaskId: string;
  initiatingSessionLease?: string;
  migrationArguments?: string[];
  verificationCommand?: string[];
  rollbackCommand?: string[];
  ttlMs?: number;
  now?: Date;
}

export async function createMigrationHandoff(options: CreateHandoffOptions): Promise<{ path: string; token: string; record: MigrationHandoffRecord }> {
  const path = resolve(options.path);
  if (existsSync(path)) throw new NamespaceError("migration_handoff_replayed", `Handoff already exists: ${path}`);
  const now = options.now ?? new Date();
  const artifactPath = resolve(options.artifactPath);
  const token = randomBytes(32).toString("base64url");
  const record: MigrationHandoffRecord = {
    schema_name: NOMX_IDENTITY.handoffSchemaName,
    schema_version: NOMX_IDENTITY.handoffSchemaVersion,
    nonce: randomUUID(),
    token_hash: sha256(token),
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + (options.ttlMs ?? 30 * 60_000)).toISOString(),
    initiating_session_id: options.initiatingSessionId,
    initiating_task_id: options.initiatingTaskId,
    ...(options.initiatingSessionLease ? { initiating_session_lease: resolve(options.initiatingSessionLease) } : {}),
    artifact_path: artifactPath,
    artifact_sha256: await sha256File(artifactPath),
    expected_source_root: resolve(options.pair.legacyRoot),
    expected_destination_root: resolve(options.pair.canonicalRoot),
    migration_arguments: options.migrationArguments ?? [],
    verification_command: options.verificationCommand ?? ["nomx", "doctor"],
    rollback_command: options.rollbackCommand ?? ["nomx", "migrate", "rollback", "--journal", `${resolve(options.pair.canonicalRoot)}.migration-journal.json`],
    status: "pending",
  };
  await atomicWriteJson(path, record, 0o600);
  await chmod(path, 0o600);
  return { path, token, record };
}

function claimedHandoffPath(path: string): string {
  return path.endsWith(".pending.json") ? `${path.slice(0, -".pending.json".length)}.claimed.json` : `${path}.claimed`;
}

function terminalHandoffPath(path: string, terminal: "consumed" | "failed"): string {
  return path.replace(/\.claimed\.json$/, `.${terminal}.json`).replace(/\.claimed$/, `.${terminal}`);
}

async function failClaimedHandoff(path: string, record: MigrationHandoffRecord, code: string): Promise<never> {
  const failed = { ...record, status: "failed" as const, error_code: code, completed_at: new Date().toISOString() };
  await atomicWriteJson(path, failed);
  await rename(path, terminalHandoffPath(path, "failed"));
  throw new NamespaceError(code as NamespaceError["code"], `Migration handoff rejected: ${code}`);
}

export async function claimMigrationHandoff(
  pendingPath: string,
  token: string,
  options: { now?: Date; pair?: NomxRootPair } = {},
): Promise<{ path: string; record: MigrationHandoffRecord }> {
  const pending = resolve(pendingPath);
  const claimed = claimedHandoffPath(pending);
  try {
    await rename(pending, claimed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NamespaceError("migration_handoff_replayed", `Handoff is absent or already consumed: ${pending}`);
    }
    throw error;
  }
  const record = JSON.parse(await readFile(claimed, "utf8")) as MigrationHandoffRecord;
  if (record.schema_name !== NOMX_IDENTITY.handoffSchemaName || record.schema_version !== 1 || record.status !== "pending") {
    return failClaimedHandoff(claimed, record, "migration_handoff_invalid");
  }
  if (record.token_hash !== sha256(token)) return failClaimedHandoff(claimed, record, "migration_handoff_tampered");
  const now = options.now ?? new Date();
  if (Date.parse(record.expires_at) <= now.getTime()) return failClaimedHandoff(claimed, record, "migration_handoff_expired");
  if (await sha256File(record.artifact_path).catch(() => "") !== record.artifact_sha256) {
    return failClaimedHandoff(claimed, record, "migration_handoff_tampered");
  }
  if (options.pair && (resolve(options.pair.legacyRoot) !== record.expected_source_root || resolve(options.pair.canonicalRoot) !== record.expected_destination_root)) {
    return failClaimedHandoff(claimed, record, "migration_handoff_tampered");
  }
  const claimedRecord = { ...record, status: "claimed" as const, claimed_at: now.toISOString() };
  await atomicWriteJson(claimed, claimedRecord);
  return { path: claimed, record: claimedRecord };
}

async function waitForLeaseToDisappear(path: string | undefined, timeoutMs: number): Promise<void> {
  if (!path) return;
  const deadline = Date.now() + timeoutMs;
  while (existsSync(path)) {
    if (Date.now() >= deadline) throw new NamespaceError("migration_active_writers", `Initiating session lease did not quiesce: ${path}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
}

export async function runMigrationHandoff(
  pendingPath: string,
  token: string,
  options: { now?: Date; waitTimeoutMs?: number; activeWriters?: MigrateDependencies["activeWriters"] } = {},
): Promise<{ path: string; record: MigrationHandoffRecord; migration: MigrationResult }> {
  const claimed = await claimMigrationHandoff(pendingPath, token, { now: options.now });
  try {
    await waitForLeaseToDisappear(claimed.record.initiating_session_lease, options.waitTimeoutMs ?? 15 * 60_000);
    const pair: NomxRootPair = {
      projectRoot: dirname(claimed.record.expected_destination_root),
      legacyRoot: claimed.record.expected_source_root,
      canonicalRoot: claimed.record.expected_destination_root,
    };
    const migration = await migrateRoot({
      pair,
      artifactPath: claimed.record.artifact_path,
      handoffNonceHash: sha256(claimed.record.nonce),
      dependencies: { activeWriters: options.activeWriters },
    });
    const consumedRecord = { ...claimed.record, status: "consumed" as const, completed_at: new Date().toISOString() };
    await atomicWriteJson(claimed.path, consumedRecord);
    const consumedPath = terminalHandoffPath(claimed.path, "consumed");
    await rename(claimed.path, consumedPath);
    return { path: consumedPath, record: consumedRecord, migration };
  } catch (error) {
    const code = error instanceof NamespaceError ? error.code : "migration_handoff_invalid";
    const failed = { ...claimed.record, status: "failed" as const, error_code: code, completed_at: new Date().toISOString() };
    await atomicWriteJson(claimed.path, failed);
    await rename(claimed.path, terminalHandoffPath(claimed.path, "failed"));
    throw error;
  }
}

export function launchDetachedMigrationHandoff(executable: string, handoffPath: string, token: string): number | undefined {
  const child = spawn(executable, ["migrate", "handoff", "run", resolve(handoffPath)], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, NOMX_HANDOFF_TOKEN: token },
  });
  child.unref();
  return child.pid;
}
