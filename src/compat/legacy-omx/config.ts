import { join } from "node:path";
import { resolveNamespaceEnvironment } from "../../identity/environment.js";

export function legacyOmxConfigFile(codexHome: string): string {
  return join(codexHome, ".omx-config.json");
}

export function legacyOmxRuntimeConfigRoot(root: string): string {
  return join(root, ".omx");
}

export function readLegacyDeepInterviewTable(parsed: unknown): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const legacy = (parsed as Record<string, unknown>).omx;
  if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) return null;
  const table = (legacy as Record<string, unknown>).deepInterview;
  return table && typeof table === "object" && !Array.isArray(table)
    ? table as Record<string, unknown>
    : null;
}

export function canonicalizeLegacyNamespaceEnvRecord(
  record: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const suffixes = new Set<string>();
  for (const key of Object.keys(record)) {
    if (key.startsWith("NOMX_")) suffixes.add(key.slice("NOMX_".length));
    if (key.startsWith("OMX_")) suffixes.add(key.slice("OMX_".length));
  }
  const canonical: NodeJS.ProcessEnv = {};
  for (const suffix of suffixes) {
    const value = resolveNamespaceEnvironment({ suffix, kind: "string" }, record).value;
    if (typeof value === "string") canonical[`NOMX_${suffix}`] = value;
  }
  return canonical;
}

export function isNomxOrLegacyOmxEnvKey(key: string): boolean {
  return key.startsWith("NOMX_") || key.startsWith("OMX_");
}

export function isLegacyOmxOwnershipMarker(value: unknown): boolean {
  return value === "omx";
}
