/**
 * Path utilities for NOMX
 * Resolves Codex CLI config, skills, prompts, and state directories
 */

import { createHash } from "crypto";
import { existsSync, realpathSync } from "fs";
import { readdir, readFile, realpath } from "fs/promises";
import { dirname, isAbsolute, join, resolve } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { NOMX_IDENTITY, resolveNamespaceEnvironment, resolveNamespacePath } from "../identity/index.js";

/** Codex CLI home directory (~/.codex/) */
export function codexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), ".codex");
}

export const NOMX_ENTRY_PATH_ENV = "NOMX_ENTRY_PATH";
export const NOMX_STARTUP_CWD_ENV = "NOMX_STARTUP_CWD";

function resolveNomxRootCandidate(raw?: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return isAbsolute(trimmed) ? trimmed : resolve(trimmed);
}

/** Optional override root for NOMX runtime files. */
export function nomxRoot(projectRoot?: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = projectRoot || process.cwd();
  const override = resolveNamespacePath("ROOT", env, base).value
    ?? resolveNamespacePath("STATE_ROOT", env, base).value;
  if (override) return join(resolveNomxRootCandidate(override) ?? override, NOMX_IDENTITY.projectDirectoryName);
  return join(base, NOMX_IDENTITY.projectDirectoryName);
}


function resolveLauncherPath(rawPath: string, baseCwd: string): string {
  const absolutePath = isAbsolute(rawPath) ? rawPath : resolve(baseCwd, rawPath);
  if (!existsSync(absolutePath)) return absolutePath;
  try {
    return typeof realpathSync.native === "function"
      ? realpathSync.native(absolutePath)
      : realpathSync(absolutePath);
  } catch {
    return absolutePath;
  }
}

export function canonicalizeComparablePath(rawPath: string): string {
  const absolutePath = resolve(rawPath);
  if (!existsSync(absolutePath)) return absolutePath;
  try {
    return typeof realpathSync.native === "function"
      ? realpathSync.native(absolutePath)
      : realpathSync(absolutePath);
  } catch {
    return absolutePath;
  }
}

export function sameFilePath(leftPath: string, rightPath: string): boolean {
  return canonicalizeComparablePath(leftPath) === canonicalizeComparablePath(rightPath);
}

export function resolveNomxEntryPath(
  options: {
    argv1?: string | null;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): string | null {
  const { cwd = process.cwd(), env = process.env } = options;
  const hasExplicitArgv1 = Object.prototype.hasOwnProperty.call(options, "argv1");
  const argv1 = hasExplicitArgv1 ? options.argv1 : process.argv[1];
  const rawPath = typeof argv1 === "string" ? argv1.trim() : "";
  const startupCwd = String(
    resolveNamespaceEnvironment({ suffix: "STARTUP_CWD", kind: "path", base: cwd }, env).value ?? cwd,
  );
  if (hasExplicitArgv1 && rawPath !== "") {
    return resolveLauncherPath(rawPath, startupCwd);
  }

  const fromEnv = String(
    resolveNamespaceEnvironment({ suffix: "ENTRY_PATH", kind: "path", base: startupCwd }, env).value ?? "",
  );
  if (fromEnv !== "") {
    return resolveLauncherPath(fromEnv, startupCwd);
  }

  if (rawPath === "") return null;

  return resolveLauncherPath(rawPath, startupCwd);
}

function isNomxCliEntryPath(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().replace(/\\/g, "/");
  return normalized.endsWith('/dist/cli/nomx.js') || normalized.endsWith('/nomx.js')
}

export function resolveNomxCliEntryPath(
  options: {
    argv1?: string | null;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    packageRootDir?: string;
  } = {},
): string | null {
  const entry = resolveNomxEntryPath(options);
  if (isNomxCliEntryPath(entry)) return entry;

  const packageRootDir = options.packageRootDir || packageRoot();
  const fallback = resolveLauncherPath(join(packageRootDir, 'dist', 'cli', 'nomx.js'), options.cwd || process.cwd());
  return existsSync(fallback) ? fallback : entry;
}

export function rememberNomxLaunchContext(
  options: {
    argv1?: string | null;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): void {
  const { cwd = process.cwd(), env = process.env } = options;
  if (env[NOMX_STARTUP_CWD_ENV] === undefined) {
    env[NOMX_STARTUP_CWD_ENV] = cwd;
  }
  const hasExplicitArgv1 = Object.prototype.hasOwnProperty.call(options, "argv1");
  const explicitArgv1 = typeof options.argv1 === "string" ? options.argv1.trim() : "";
  if (env[NOMX_ENTRY_PATH_ENV] !== undefined && (!hasExplicitArgv1 || explicitArgv1 === "")) return;

  const resolved = hasExplicitArgv1
    ? resolveNomxEntryPath({
      argv1: options.argv1,
      cwd,
      env,
    })
    : resolveNomxEntryPath({
      cwd,
      env,
    });
  if (resolved) {
    env[NOMX_ENTRY_PATH_ENV] = resolved;
  }
}

/** Codex config file path (~/.codex/config.toml) */
export function codexConfigPath(): string {
  return join(codexHome(), "config.toml");
}

/** Codex prompts directory (~/.codex/prompts/) */
export function codexPromptsDir(): string {
  return join(codexHome(), "prompts");
}

/** Codex native agents directory (~/.codex/agents/) */
export function codexAgentsDir(codexHomeDir?: string): string {
  return join(codexHomeDir || codexHome(), "agents");
}

/** Project-level Codex native agents directory (.codex/agents/) */
export function projectCodexAgentsDir(projectRoot?: string): string {
  return join(projectRoot || process.cwd(), ".codex", "agents");
}

/** User-level skills directory ($CODEX_HOME/skills, defaults to ~/.codex/skills/) */
export function userSkillsDir(): string {
  return join(codexHome(), "skills");
}

/** Project-level skills directory (.codex/skills/) */
export function projectSkillsDir(projectRoot?: string): string {
  return join(projectRoot || process.cwd(), ".codex", "skills");
}

/** Historical legacy user-level skills directory (~/.agents/skills/) */
export function legacyUserSkillsDir(): string {
  return join(homedir(), ".agents", "skills");
}

export type InstalledSkillScope = "project" | "user";

export interface InstalledSkillDirectory {
  name: string;
  path: string;
  scope: InstalledSkillScope;
}

export interface SkillRootOverlapReport {
  canonicalDir: string;
  legacyDir: string;
  canonicalExists: boolean;
  legacyExists: boolean;
  canonicalResolvedDir: string | null;
  legacyResolvedDir: string | null;
  sameResolvedTarget: boolean;
  canonicalSkillCount: number;
  legacySkillCount: number;
  overlappingSkillNames: string[];
  mismatchedSkillNames: string[];
}

async function readInstalledSkillsFromDir(
  dir: string,
  scope: InstalledSkillScope,
): Promise<InstalledSkillDirectory[]> {
  if (!existsSync(dir)) return [];

  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: join(dir, entry.name),
      scope,
    }))
    .filter((entry) => existsSync(join(entry.path, "SKILL.md")))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Installed skill directories in scope-precedence order.
 * Project skills win over user-level skills with the same directory basename.
 */
export async function listInstalledSkillDirectories(
  projectRoot?: string,
): Promise<InstalledSkillDirectory[]> {
  const orderedDirs: Array<{ dir: string; scope: InstalledSkillScope }> = [
    { dir: projectSkillsDir(projectRoot), scope: "project" },
    { dir: userSkillsDir(), scope: "user" },
  ];

  const deduped: InstalledSkillDirectory[] = [];
  const seenNames = new Set<string>();

  for (const { dir, scope } of orderedDirs) {
    const skills = await readInstalledSkillsFromDir(dir, scope);
    for (const skill of skills) {
      if (seenNames.has(skill.name)) continue;
      seenNames.add(skill.name);
      deduped.push(skill);
    }
  }

  return deduped;
}

export async function detectLegacySkillRootOverlap(
  canonicalDir = userSkillsDir(),
  legacyDir = legacyUserSkillsDir(),
): Promise<SkillRootOverlapReport> {
  const canonicalExists = existsSync(canonicalDir);
  const legacyExists = existsSync(legacyDir);
  const [canonicalSkills, legacySkills, canonicalResolvedDir, legacyResolvedDir] = await Promise.all([
    readInstalledSkillsFromDir(canonicalDir, "user"),
    readInstalledSkillsFromDir(legacyDir, "user"),
    canonicalExists ? realpath(canonicalDir).catch(() => null) : Promise.resolve(null),
    legacyExists ? realpath(legacyDir).catch(() => null) : Promise.resolve(null),
  ]);

  const canonicalHashes = await hashSkillDirectory(canonicalSkills);
  const legacyHashes = await hashSkillDirectory(legacySkills);
  const canonicalNames = new Set(canonicalSkills.map((skill) => skill.name));
  const legacyNames = new Set(legacySkills.map((skill) => skill.name));
  const overlappingSkillNames = [...canonicalNames]
    .filter((name) => legacyNames.has(name))
    .sort((a, b) => a.localeCompare(b));
  const mismatchedSkillNames = overlappingSkillNames.filter(
    (name) => canonicalHashes.get(name) !== legacyHashes.get(name),
  );
  const sameResolvedTarget =
    canonicalResolvedDir !== null &&
    legacyResolvedDir !== null &&
    canonicalResolvedDir === legacyResolvedDir;

  return {
    canonicalDir,
    legacyDir,
    canonicalExists,
    legacyExists,
    canonicalResolvedDir,
    legacyResolvedDir,
    sameResolvedTarget,
    canonicalSkillCount: canonicalSkills.length,
    legacySkillCount: legacySkills.length,
    overlappingSkillNames,
    mismatchedSkillNames,
  };
}

async function hashSkillDirectory(
  skills: InstalledSkillDirectory[],
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();

  for (const skill of skills) {
    try {
      const content = await readFile(join(skill.path, "SKILL.md"), "utf-8");
      hashes.set(skill.name, createHash("sha256").update(content).digest("hex"));
    } catch {
      // Ignore unreadable SKILL.md files; existence is enough for overlap detection.
    }
  }

  return hashes;
}

/** NOMX state directory (.nomx/state/) */
export function nomxStateDir(projectRoot?: string): string {
  return join(nomxRoot(projectRoot), "state");
}

/** nomx project memory file (.nomx/project-memory.json) */
export function nomxProjectMemoryPath(projectRoot?: string): string {
  return join(nomxRoot(projectRoot), "project-memory.json");
}

/** Repository-visible project memory file used as canonical startup context. */
export function canonicalProjectMemoryPath(projectRoot?: string): string {
  return join(projectRoot || process.cwd(), "project-memory.json");
}

/** CLI-compatible repository-local project memory file (.nomx/project-memory.json). */
export function repoLocalProjectMemoryPath(projectRoot?: string): string {
  return join(projectRoot || process.cwd(), ".nomx", "project-memory.json");
}

/**
 * Project memory read order for startup context.
 *
 * Keep the repository-visible root file first for existing SessionStart compatibility,
 * then include the CLI/MCP project-memory location before boxed NOMX runtime memory.
 */
export function projectMemoryPathCandidates(projectRoot?: string): string[] {
  const candidates = [
    canonicalProjectMemoryPath(projectRoot),
    repoLocalProjectMemoryPath(projectRoot),
    nomxProjectMemoryPath(projectRoot),
  ];
  return candidates.filter((path, index) => candidates.indexOf(path) === index);
}

/** First readable project memory path, preferring repository-visible canonical memory. */
export function resolveProjectMemoryPath(projectRoot?: string): string | null {
  for (const path of projectMemoryPathCandidates(projectRoot)) {
    if (existsSync(path)) return path;
  }
  return null;
}

/** nomx notepad file (.nomx/notepad.md) */
export function nomxNotepadPath(projectRoot?: string): string {
  return join(nomxRoot(projectRoot), "notepad.md");
}

/** nomx wiki directory (repository-root nomx_wiki/) */
export function nomxWikiDir(projectRoot?: string): string {
  return join(projectRoot || process.cwd(), "nomx_wiki");
}

/** Legacy project-local wiki directory used before wiki pages became repository-tracked. */
export function nomxLegacyWikiDir(projectRoot?: string): string {
  return join(projectRoot || process.cwd(), ".nomx", "wiki");
}

/** nomx plans directory (.nomx/plans/) */
export function nomxPlansDir(projectRoot?: string): string {
  return join(nomxRoot(projectRoot), "plans");
}

/** nomx adapters directory (.nomx/adapters/) */
export function nomxAdaptersDir(projectRoot?: string): string {
  return join(nomxRoot(projectRoot), "adapters");
}

/** nomx logs directory (.nomx/logs/) */
export function nomxLogsDir(projectRoot?: string): string {
  return join(nomxRoot(projectRoot), "logs");
}

/** User-scope install/update stamp path ($CODEX_HOME/.nomx/install-state.json) */
export function nomxUserInstallStampPath(codexHomeDir?: string): string {
  return join(codexHomeDir || codexHome(), ".nomx", "install-state.json");
}

/** @deprecated Import the canonical NOMX-named helpers instead. */
export const omxRoot = nomxRoot;
/** @deprecated Import the canonical NOMX-named helpers instead. */
export const resolveOmxEntryPath = resolveNomxEntryPath;
/** @deprecated Import the canonical NOMX-named helpers instead. */
export const resolveOmxCliEntryPath = resolveNomxCliEntryPath;
/** @deprecated Import the canonical NOMX-named helpers instead. */
export const rememberOmxLaunchContext = rememberNomxLaunchContext;
/** @deprecated Import the canonical NOMX-named helpers instead. */
export const omxStateDir = nomxStateDir;
/** @deprecated Import the canonical NOMX-named helpers instead. */
export const omxProjectMemoryPath = nomxProjectMemoryPath;
/** @deprecated Import the canonical NOMX-named helpers instead. */
export const omxNotepadPath = nomxNotepadPath;
/** @deprecated Import the canonical NOMX-named helpers instead. */
export const omxWikiDir = nomxWikiDir;
/** @deprecated Import the canonical NOMX-named helpers instead. */
export const omxLegacyWikiDir = nomxLegacyWikiDir;
/** @deprecated Import the canonical NOMX-named helpers instead. */
export const omxPlansDir = nomxPlansDir;
/** @deprecated Import the canonical NOMX-named helpers instead. */
export const omxAdaptersDir = nomxAdaptersDir;
/** @deprecated Import the canonical NOMX-named helpers instead. */
export const omxLogsDir = nomxLogsDir;
/** @deprecated Import the canonical NOMX-named helpers instead. */
export const omxUserInstallStampPath = nomxUserInstallStampPath;

/** Get the package root directory (where agents/, skills/, prompts/ live) */
export function packageRoot(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const candidate = join(__dirname, "..", "..");
    if (existsSync(join(candidate, "package.json"))) {
      return candidate;
    }
    const candidate2 = join(__dirname, "..");
    if (existsSync(join(candidate2, "package.json"))) {
      return candidate2;
    }
  } catch {
    // fall through to cwd fallback
  }
  return process.cwd();
}
