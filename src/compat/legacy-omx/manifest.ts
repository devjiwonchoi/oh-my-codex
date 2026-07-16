import manifest from "./legacy-abi-manifest.json" with { type: "json" };

export type LegacyAbiKind = "managed_marker" | "persisted_field" | "hash_domain";

export interface LegacyAbiEntry {
  token: string;
  kind: LegacyAbiKind;
  file_patterns: string[];
  rationale: string;
  removal_policy: string;
  schema_version?: number;
}

export interface LegacyAbiManifest {
  schema_version: number;
  entries: LegacyAbiEntry[];
}

export function validateLegacyAbiManifest(value: unknown = manifest): LegacyAbiManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("legacy ABI manifest must be an object");
  const candidate = value as { schema_version?: unknown; entries?: unknown };
  if (candidate.schema_version !== 1 || !Array.isArray(candidate.entries)) throw new Error("unsupported legacy ABI manifest schema");
  for (const entry of candidate.entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("legacy ABI entry must be an object");
    const item = entry as Partial<LegacyAbiEntry>;
    if (!item.token || !["managed_marker", "persisted_field", "hash_domain"].includes(String(item.kind))
      || !Array.isArray(item.file_patterns) || item.file_patterns.length === 0
      || !item.rationale || !item.removal_policy) {
      throw new Error(`invalid legacy ABI manifest entry: ${String(item.token ?? "unknown")}`);
    }
  }
  return value as LegacyAbiManifest;
}

export const LEGACY_ABI_MANIFEST = validateLegacyAbiManifest();
