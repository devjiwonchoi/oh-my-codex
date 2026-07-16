#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import process from "node:process";
import {
  LEGACY_ABI_MANIFEST,
  type LegacyAbiEntry,
  validateLegacyAbiManifest,
} from "../compat/legacy-omx/manifest.js";

const TEXT_EXTENSIONS = new Set([
  ".cjs", ".js", ".json", ".md", ".mjs", ".toml", ".ts", ".tsx", ".yaml", ".yml",
]);

const IGNORED_DIRECTORIES = new Set([
  ".git", ".nomx", ".omx", "coverage", "dist", "node_modules", "target",
]);

const LEGACY_FIXTURE_PATTERNS = [
  "src/identity/**",
  "src/compat/legacy-omx/**",
  "src/scripts/audit-nomx-identity.ts",
  "src/**/__tests__/**",
  "src/**/fixtures/**",
];

const FORBIDDEN_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: "legacy_product_identity", pattern: /oh-my-codex|(?<!N)\bOMX\b/g },
  { code: "legacy_runtime_root", pattern: /(?:^|[\\/])\.omx(?:[\\/]|$)|["'`]\.omx["'`]/gm },
  { code: "legacy_environment", pattern: /(?<!N)\bOMX_[A-Z0-9_]+\b/g },
  { code: "legacy_mcp_id", pattern: /\bomx_[a-z0-9_]+\b/g },
];

export interface NomxIdentityAuditFinding {
  code: string;
  file: string;
  line: number;
  match: string;
}

export interface NomxIdentityAuditOptions {
  root?: string;
  manifest?: unknown;
}

function globPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesAny(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globPatternToRegExp(pattern).test(file));
}

function lineForOffset(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function manifestEntryForMatch(
  file: string,
  source: string,
  offset: number,
  match: string,
  entries: LegacyAbiEntry[],
): LegacyAbiEntry | undefined {
  return entries.find((entry) => {
    if (!entry.token.includes(match) || !matchesAny(file, entry.file_patterns)) return false;
    let tokenOffset = source.indexOf(entry.token);
    while (tokenOffset >= 0) {
      if (offset >= tokenOffset && offset + match.length <= tokenOffset + entry.token.length) return true;
      tokenOffset = source.indexOf(entry.token, tokenOffset + 1);
    }
    return false;
  });
}

async function collectFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(root, path));
    } else if (entry.isFile() && (TEXT_EXTENSIONS.has(extname(entry.name)) || entry.name === "AGENTS.md")) {
      files.push(path);
    }
  }
  return files;
}

export async function auditNomxIdentity(
  options: NomxIdentityAuditOptions = {},
): Promise<NomxIdentityAuditFinding[]> {
  const root = resolve(options.root ?? process.cwd());
  const manifest = validateLegacyAbiManifest(options.manifest ?? LEGACY_ABI_MANIFEST);
  const findings: NomxIdentityAuditFinding[] = [];
  for (const path of await collectFiles(root)) {
    const file = relative(root, path).replace(/\\/g, "/");
    const source = await readFile(path, "utf8");
    const legacyFixture = matchesAny(file, LEGACY_FIXTURE_PATTERNS);
    for (const { code, pattern } of FORBIDDEN_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const offset = match.index ?? 0;
        const token = match[0];
        if (legacyFixture || manifestEntryForMatch(file, source, offset, token, manifest.entries)) continue;
        findings.push({ code, file, line: lineForOffset(source, offset), match: token });
      }
    }
  }
  return findings.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.code.localeCompare(right.code));
}

export async function main(): Promise<void> {
  const findings = await auditNomxIdentity();
  if (findings.length === 0) {
    console.log("NOMX identity audit passed.");
    return;
  }
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} ${finding.code}: ${JSON.stringify(finding.match)}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  void main();
}
