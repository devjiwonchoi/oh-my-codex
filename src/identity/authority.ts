import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { NOMX_IDENTITY, LEGACY_OMX_IDENTITY, NamespaceError } from "./constants.js";
import { validateCompletedMigrationRecord, validateNomxRootMetadata, type NomxCompletedMigrationRecord, type NomxRootMetadata } from "./schema.js";

export type NomxAuthorityState =
  | "fresh_nomx"
  | "legacy_only"
  | "nomx_only"
  | "dual_root_complete"
  | "dual_root_conflict"
  | "migration_preparing"
  | "migration_copied"
  | "migration_verified"
  | "migration_complete"
  | "metadata_invalid";

export interface NomxRootPair {
  projectRoot: string;
  canonicalRoot: string;
  legacyRoot: string;
}

export interface NomxAuthorityDecision {
  state: NomxAuthorityState;
  writable: boolean;
  canonicalRoot: string;
  legacyRoot: string;
  metadata?: NomxRootMetadata;
  migration?: NomxCompletedMigrationRecord;
  errorCode?: NamespaceError["code"];
}

export function nominalRootPair(projectRoot = process.cwd()): NomxRootPair {
  const resolved = resolve(projectRoot);
  return {
    projectRoot: resolved,
    canonicalRoot: join(resolved, NOMX_IDENTITY.projectDirectoryName),
    legacyRoot: join(resolved, LEGACY_OMX_IDENTITY.projectDirectoryName),
  };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export async function resolveNomxAuthority(pair: NomxRootPair): Promise<NomxAuthorityDecision> {
  const canonicalExists = existsSync(pair.canonicalRoot);
  const legacyExists = existsSync(pair.legacyRoot);
  if (!canonicalExists && !legacyExists) {
    return { state: "fresh_nomx", writable: true, canonicalRoot: pair.canonicalRoot, legacyRoot: pair.legacyRoot };
  }
  if (!canonicalExists) {
    return {
      state: "legacy_only",
      writable: false,
      canonicalRoot: pair.canonicalRoot,
      legacyRoot: pair.legacyRoot,
      errorCode: "migration_required",
    };
  }

  let metadata: NomxRootMetadata;
  try {
    metadata = validateNomxRootMetadata(
      await readJson(join(pair.canonicalRoot, "identity.json")),
      pair.canonicalRoot,
    );
  } catch {
    return {
      state: "metadata_invalid",
      writable: false,
      canonicalRoot: pair.canonicalRoot,
      legacyRoot: pair.legacyRoot,
      errorCode: "namespace_metadata_invalid",
    };
  }
  if (!legacyExists) {
    return { state: "nomx_only", writable: true, canonicalRoot: pair.canonicalRoot, legacyRoot: pair.legacyRoot, metadata };
  }

  const journalPath = `${pair.canonicalRoot}.migration-journal.json`;
  if (existsSync(journalPath)) {
    try {
      const journal = await readJson(journalPath) as { phase?: string };
      if (["preparing", "copied", "verified", "complete"].includes(String(journal.phase))) {
        const state = `migration_${journal.phase}` as NomxAuthorityState;
        if (journal.phase !== "complete") {
          return { state, writable: false, canonicalRoot: pair.canonicalRoot, legacyRoot: pair.legacyRoot, metadata, errorCode: "migration_required" };
        }
      }
    } catch {
      return { state: "dual_root_conflict", writable: false, canonicalRoot: pair.canonicalRoot, legacyRoot: pair.legacyRoot, metadata, errorCode: "namespace_migration_conflict" };
    }
  }

  try {
    const migration = validateCompletedMigrationRecord(
      await readJson(join(pair.canonicalRoot, "migration.json")),
      metadata,
      pair.legacyRoot,
      pair.canonicalRoot,
    );
    return { state: "dual_root_complete", writable: true, canonicalRoot: pair.canonicalRoot, legacyRoot: pair.legacyRoot, metadata, migration };
  } catch {
    return {
      state: "dual_root_conflict",
      writable: false,
      canonicalRoot: pair.canonicalRoot,
      legacyRoot: pair.legacyRoot,
      metadata,
      errorCode: "namespace_migration_conflict",
    };
  }
}

export async function requireNomxWritable(pair: NomxRootPair): Promise<NomxAuthorityDecision> {
  const decision = await resolveNomxAuthority(pair);
  if (!decision.writable) {
    throw new NamespaceError(decision.errorCode ?? "migration_required", `NOMX root is not writable while authority is ${decision.state}`);
  }
  return decision;
}
