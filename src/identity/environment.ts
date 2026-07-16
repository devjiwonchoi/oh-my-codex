import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { NamespaceError } from "./constants.js";

export type NamespaceEnvironmentKind = "path" | "string" | "boolean";

export interface NamespaceEnvironmentSpec {
  suffix: string;
  kind: NamespaceEnvironmentKind;
  base?: string;
}

export interface ResolvedNamespaceEnvironment {
  suffix: string;
  source: "nomx" | "legacy" | "absent";
  value: string | boolean | undefined;
  canonicalName: string;
  legacyName: string;
}

function invalid(name: string, reason: string): never {
  throw new NamespaceError("namespace_env_invalid", `${name} ${reason}`);
}

export function canonicalizeNamespacePath(raw: string, base = process.cwd()): string {
  const trimmed = raw.trim();
  if (!trimmed) invalid("namespace path", "cannot be empty or whitespace-only");
  const absolute = normalize(isAbsolute(trimmed) ? trimmed : resolve(base, trimmed));
  let existingAncestor = absolute;
  const suffix: string[] = [];
  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) return absolute;
    suffix.unshift(basename(existingAncestor));
    existingAncestor = parent;
  }
  try {
    const resolved = typeof realpathSync.native === "function"
      ? realpathSync.native(existingAncestor)
      : realpathSync(existingAncestor);
    return normalize(join(resolved, ...suffix));
  } catch {
    return absolute;
  }
}

function normalizedPath(raw: string, base: string): string {
  return platformComparablePath(canonicalizeNamespacePath(raw, base));
}

function platformComparablePath(value: string): string {
  const withoutTrailingSeparators = value.replace(/[\\/]+$/, "") || value;
  return process.platform === "win32" ? withoutTrailingSeparators.toLowerCase() : withoutTrailingSeparators;
}

function normalizedBoolean(raw: string, name: string): boolean {
  switch (raw.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return invalid(name, "must be a boolean (1/0, true/false, yes/no, or on/off)");
  }
}

function normalizeValue(raw: string | undefined, name: string, spec: NamespaceEnvironmentSpec): string | boolean | undefined {
  if (raw === undefined) return undefined;
  // Shell launchers and inherited test/process environments commonly retain
  // optional variables as empty strings. Treat those as unset so canonical
  // NOMX variables can safely replace legacy OMX aliases without turning a
  // harmless sanitization value into a launch failure.
  if (raw.trim() === "") return undefined;
  if (spec.kind === "path") return normalizedPath(raw, spec.base ?? process.cwd());
  if (spec.kind === "boolean") return normalizedBoolean(raw, name);
  return raw.trim();
}

export function resolveNamespaceEnvironment(
  spec: NamespaceEnvironmentSpec,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedNamespaceEnvironment {
  const canonicalName = `NOMX_${spec.suffix}`;
  const legacyName = `OMX_${spec.suffix}`;
  const canonical = normalizeValue(env[canonicalName], canonicalName, spec);
  const legacy = normalizeValue(env[legacyName], legacyName, spec);
  if (canonical !== undefined && legacy !== undefined && canonical !== legacy) {
    throw new NamespaceError(
      "namespace_env_conflict",
      `${canonicalName} and ${legacyName} resolve to non-equivalent values`,
    );
  }
  if (canonical !== undefined) {
    return { suffix: spec.suffix, source: "nomx", value: canonical, canonicalName, legacyName };
  }
  if (legacy !== undefined) {
    return { suffix: spec.suffix, source: "legacy", value: legacy, canonicalName, legacyName };
  }
  return { suffix: spec.suffix, source: "absent", value: undefined, canonicalName, legacyName };
}

export function resolveNamespacePath(
  suffix: string,
  env: NodeJS.ProcessEnv = process.env,
  base = process.cwd(),
): ResolvedNamespaceEnvironment & { value: string | undefined } {
  return resolveNamespaceEnvironment({ suffix, kind: "path", base }, env) as ResolvedNamespaceEnvironment & { value: string | undefined };
}
