import { randomUUID } from "node:crypto";
import { release, hostname } from "node:os";
import { NOMX_IDENTITY, NamespaceError } from "./constants.js";
import { canonicalizeNamespacePath } from "./environment.js";

export interface NomxPlatformFacts {
  platform: NodeJS.Platform;
  release: string;
  hostname: string;
}

export interface NomxRootMetadata {
  schema_name: typeof NOMX_IDENTITY.schemaName;
  schema_version: typeof NOMX_IDENTITY.schemaVersion;
  root_uuid: string;
  created_at: string;
  canonical_resolved_root: string;
  platform: NomxPlatformFacts;
  writer_generation: number;
}

export interface NomxCompletedMigrationRecord {
  schema_name: typeof NOMX_IDENTITY.migrationSchemaName;
  schema_version: typeof NOMX_IDENTITY.migrationSchemaVersion;
  source_legacy_root: string;
  source_legacy_identity: string;
  destination_root_uuid: string;
  destination_root: string;
  inventory_digest: string;
  artifact_sha256: string;
  journal_generation: number;
  journal_nonce: string;
  permissions: { mode: number; uid?: number; gid?: number };
  device: { source_dev?: number; destination_dev?: number };
  phase: "complete";
  completed_at: string;
  verification: { result: "passed"; verified_at: string };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function currentPlatformFacts(): NomxPlatformFacts {
  return { platform: process.platform, release: release(), hostname: hostname() };
}

export function createNomxRootMetadata(root: string, now = new Date()): NomxRootMetadata {
  return {
    schema_name: NOMX_IDENTITY.schemaName,
    schema_version: NOMX_IDENTITY.schemaVersion,
    root_uuid: randomUUID(),
    created_at: now.toISOString(),
    canonical_resolved_root: canonicalizeNamespacePath(root),
    platform: currentPlatformFacts(),
    writer_generation: 0,
  };
}

export function validateNomxRootMetadata(value: unknown, expectedRoot: string): NomxRootMetadata {
  if (!isRecord(value)
    || value.schema_name !== NOMX_IDENTITY.schemaName
    || value.schema_version !== NOMX_IDENTITY.schemaVersion
    || typeof value.root_uuid !== "string" || !UUID_PATTERN.test(value.root_uuid)
    || !isIsoTimestamp(value.created_at)
    || value.canonical_resolved_root !== canonicalizeNamespacePath(expectedRoot)
    || !isRecord(value.platform)
    || typeof value.platform.platform !== "string"
    || typeof value.platform.release !== "string"
    || typeof value.platform.hostname !== "string"
    || !Number.isSafeInteger(value.writer_generation) || Number(value.writer_generation) < 0) {
    throw new NamespaceError("namespace_metadata_invalid", `Invalid NOMX root metadata for ${expectedRoot}`);
  }
  return value as unknown as NomxRootMetadata;
}

export function validateCompletedMigrationRecord(
  value: unknown,
  metadata: NomxRootMetadata,
  sourceRoot: string,
  destinationRoot: string,
): NomxCompletedMigrationRecord {
  if (!isRecord(value)
    || value.schema_name !== NOMX_IDENTITY.migrationSchemaName
    || value.schema_version !== NOMX_IDENTITY.migrationSchemaVersion
    || value.source_legacy_root !== canonicalizeNamespacePath(sourceRoot)
    || typeof value.source_legacy_identity !== "string" || value.source_legacy_identity.length < 1
    || value.destination_root_uuid !== metadata.root_uuid
    || value.destination_root !== canonicalizeNamespacePath(destinationRoot)
    || typeof value.inventory_digest !== "string" || !SHA256_PATTERN.test(value.inventory_digest)
    || typeof value.artifact_sha256 !== "string" || !SHA256_PATTERN.test(value.artifact_sha256)
    || !Number.isSafeInteger(value.journal_generation) || Number(value.journal_generation) < 1
    || typeof value.journal_nonce !== "string" || !UUID_PATTERN.test(value.journal_nonce)
    || !isRecord(value.permissions) || !Number.isSafeInteger(value.permissions.mode)
    || !isRecord(value.device)
    || value.phase !== "complete"
    || !isIsoTimestamp(value.completed_at)
    || !isRecord(value.verification) || value.verification.result !== "passed"
    || !isIsoTimestamp(value.verification.verified_at)) {
    throw new NamespaceError("namespace_migration_conflict", `Invalid or mismatched NOMX migration record for ${destinationRoot}`);
  }
  return value as unknown as NomxCompletedMigrationRecord;
}
