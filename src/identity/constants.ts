export const NOMX_IDENTITY = Object.freeze({
  productName: "NOMX",
  packageName: "nomx",
  binaryName: "nomx",
  projectDirectoryName: ".nomx",
  userDirectoryName: ".nomx",
  environmentPrefix: "NOMX_",
  schemaName: "nomx-runtime",
  schemaVersion: 1,
  migrationSchemaName: "nomx-migration",
  migrationSchemaVersion: 1,
  handoffSchemaName: "nomx-migration-handoff",
  handoffSchemaVersion: 1,
} as const);

export const NOMX_SESSION_ID_PREFIX = "nomx-";

/** Read-only compatibility identity. New runtime state must never be written here. */
export const LEGACY_OMX_IDENTITY = Object.freeze({
  productName: "OMX",
  packageName: "oh-my-codex",
  projectDirectoryName: ".omx",
  userDirectoryName: ".omx",
  environmentPrefix: "OMX_",
} as const);

export type NamespaceErrorCode =
  | "migration_required"
  | "namespace_env_invalid"
  | "namespace_env_conflict"
  | "namespace_metadata_invalid"
  | "namespace_migration_conflict"
  | "migration_active_writers"
  | "migration_lease_held"
  | "migration_source_invalid"
  | "migration_verification_failed"
  | "migration_handoff_invalid"
  | "migration_handoff_expired"
  | "migration_handoff_replayed"
  | "migration_handoff_tampered";

export class NamespaceError extends Error {
  readonly code: NamespaceErrorCode;

  constructor(code: NamespaceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NamespaceError";
    this.code = code;
  }
}
