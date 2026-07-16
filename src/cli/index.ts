/**
 * nomx CLI
 * Multi-agent orchestration for OpenAI Codex CLI
 */

import { execFileSync, spawn } from "child_process";
import { basename, dirname, join, posix, resolve, win32 } from "path";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "fs";
import { copyFile, cp, lstat, mkdir, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "fs/promises";
import { constants as osConstants, homedir } from "os";
import { createHash, randomUUID } from "crypto";
import {
  setup,
  SETUP_MCP_MODES,
  SETUP_SCOPES,
  type SetupInstallMode,
  type SetupMcpMode,
  type SetupScope,
} from "./setup.js";
import { uninstall } from "./uninstall.js";
import { version } from "./version.js";
import { hooksCommand } from "./hooks.js";
import { hudCommand } from "../hud/index.js";
import { ralphCommand } from "./ralph.js";
import { ralplanCommand } from "./ralplan.js";
import { ultragoalCommand } from "./ultragoal.js";
import { stateCommand } from "./state.js";
import {
  cleanupCommand,
  cleanupNomxMcpProcesses,
  findLaunchSafeCleanupCandidates,
  type CleanupDependencies,
  type CleanupResult,
} from "./cleanup.js";
import { agentsInitCommand } from "./agents-init.js";
import { agentsCommand } from "./agents.js";
import { mcpParityCommand } from "./mcp-parity.js";
import { mcpServeCommand } from "./mcp-serve.js";
import { listCommand } from "./list.js";
import {
  MADMAX_FLAG,
  CODEX_BYPASS_FLAG,
  HIGH_REASONING_FLAG,
  XHIGH_REASONING_FLAG,
  SPARK_FLAG,
  MADMAX_SPARK_FLAG,
  CONFIG_FLAG,
  LONG_CONFIG_FLAG,
} from "./constants.js";
import {
  getBaseStateDir,
  getStateDir,
  listModeStateFilesWithScopePreference,
  resolveWritableStateScope,
  type ModeStateFileRef,
} from "../mcp/state-paths.js";
import { evaluateRalphCompletionAuditEvidence, isRalphCompletePhase } from "../ralph/completion-audit.js";
import { normalizeTerminalWorkflowState } from "../state/terminal-normalization.js";
import {
  readPersistedSetupPreferences,
  resolveCodexConfigPathForLaunch,
  resolveCodexHomeForLaunch,
  resolveProjectLocalCodexHomeForLaunch,
} from "./codex-home.js";
import { discoverProjectRuntimeCodexHomes } from "./project-runtime-codex-homes.js";
import {
  discoverOmxPluginCacheDirs,
  hasLocalOmxPluginEnablement,
  materializePackagedOmxPluginCache,
  packagedOmxPluginVersion,
  resolvePackagedOmxMarketplace,
  upsertLocalOmxMarketplaceRegistration,
  upsertLocalOmxPluginEnablement,
} from "./plugin-marketplace.js";
import { escapeTomlString, readTopLevelTomlString, upsertTopLevelTomlString } from "../utils/toml.js";
import {
  CANONICAL_REASONING_EFFORTS,
  isAmbiguousUnsupportedReasoningEffort,
} from "../config/models.js";


export {
  readPersistedSetupPreferences,
  readPersistedSetupScope,
  resolveCodexConfigPathForLaunch,
  resolveCodexHomeForLaunch,
  resolveProjectLocalCodexHomeForLaunch,
} from "./codex-home.js";
import {
  SKILL_ACTIVE_STATE_MODE,
  extractSessionIdFromInitializedStatePath,
  getSkillActiveStatePathsForStateDir,
  listActiveSkills,
  readSkillActiveState,
  syncCanonicalSkillStateForMode,
  type SkillActiveStateLike,
} from "../state/skill-active.js";
import { isTrackedWorkflowMode } from "../state/workflow-transition.js";
import { maybeCheckAndPromptUpdate, runImmediateUpdate, type UpdateChannel } from "./update.js";
import { maybePromptGithubStar } from "./star-prompt.js";
import {
  generateOverlay,
  removeSessionModelInstructionsFile,
  resolveSessionOrchestrationMode,
  sessionModelInstructionsPath,
  writeSessionModelInstructionsFile,
} from "../hooks/agents-overlay.js";
import {
  isSessionPointerLaunchAbort,
  readSessionState,
  writeSessionStart,
  writeSessionEnd,
  resetSessionMetrics,
} from "../hooks/session.js";
import { getPackageRoot } from "../utils/package.js";
import { codexConfigPath, nomxRoot, rememberOmxLaunchContext, resolveOmxCliEntryPath } from "../utils/paths.js";
import { cleanCodexModelAvailabilityNuxIfNeeded, extractSharedMcpRegistryServersFromConfig, repairConfigIfNeeded, repairProjectScopeTrustStateForLaunch, syncProjectScopeTrustStateFromRuntime } from "../config/generator.js";
import type { UnifiedMcpRegistryServer } from "../config/mcp-registry.js";
import { NOMX_FIRST_PARTY_MCP_SERVER_NAMES } from "../config/nomx-first-party-mcp.js";
import { readUltragoalState } from "../hud/state.js";
import { classifySpawnError, spawnPlatformCommandSync } from "../utils/platform-command.js";

rememberOmxLaunchContext({ argv1: process.argv[1], cwd: process.cwd(), env: process.env });
import { buildHookEvent } from "../hooks/extensibility/events.js";
import { dispatchHookEvent } from "../hooks/extensibility/dispatcher.js";
import {
  NOMX_NOTIFY_TEMP_CONTRACT_ENV,
  parseNotifyTempContractFromArgs,
  serializeNotifyTempContract,
  type NotifyTempContract,
  type ParseNotifyTempContractResult,
} from "../notifications/temp-contract.js";
import { execInjectCommand } from "../exec/followup.js";

export function resolveNotifyFallbackWatcherScript(pkgRoot = getPackageRoot()): string {
  return resolveDistScript(pkgRoot, "notify-fallback-watcher.js");
}

export function resolveHookDerivedWatcherScript(pkgRoot = getPackageRoot()): string {
  return resolveDistScript(pkgRoot, "hook-derived-watcher.js");
}

export function resolveNotifyHookScript(pkgRoot = getPackageRoot()): string {
  return resolveDistScript(pkgRoot, "notify-hook.js");
}

function resolveDistScript(pkgRoot: string, scriptName: string): string {
  return join(pkgRoot, "dist", "scripts", scriptName);
}

export const HELP = `
nomx (nomx) - Multi-agent orchestration for Codex CLI

Usage:
  nomx           Launch Codex CLI directly
  nomx exec      Run codex exec non-interactively with NOMX AGENTS/overlay injection
  nomx exec inject <session-id> --prompt <text>
                Queue audited follow-up instructions for a running non-interactive exec job
  nomx setup     Install skills, prompts, CLI-first config, and scope-specific AGENTS.md
                (user scope prompts for legacy vs plugin skill delivery when needed)
  nomx update    Install the stable channel now, then refresh setup
  nomx update --stable
                Install/rollback to npm stable (nomx@latest), then refresh setup
  nomx update --dev
                Install the upstream dev branch, then refresh setup
  nomx uninstall Remove NOMX configuration and clean up installed artifacts
  nomx doctor    Check installation health
  nomx migrate   Safely inspect, migrate, recover, or roll back legacy runtime state
  nomx list      List packaged NOMX skills and native agent prompts (--json)
  nomx cleanup   Kill orphaned NOMX MCP server processes and remove stale NOMX /tmp directories
  nomx resume    Resume Codex sessions (supports --project and --codex-home <path>)
  nomx agents-init [path]
                Bootstrap lightweight AGENTS.md files for a repo/subtree
  nomx agents    Manage Codex native agent TOML files
  nomx deepinit [path]
                Alias for agents-init (lightweight AGENTS bootstrap only)
  nomx ralph     Launch Codex with ralph persistence mode active
  nomx ralplan   Record validated role intents for adapted native subagent spawns
  nomx ultragoal Create, resume, and checkpoint durable multi-goal plans over Codex goal mode
  nomx version   Show version information
  nomx hooks     Manage hook plugins (init|status|validate|test)
  nomx hud       Show HUD statusline (--watch, --json, --preset=NAME)
  nomx state     Read/write/list NOMX mode state via CLI parity surface
  nomx notepad   JSON CLI surface for NOMX notepad operations
  nomx project-memory
                JSON CLI surface for NOMX project-memory operations
  nomx trace     JSON CLI surface for NOMX trace operations
  nomx code-intel
                JSON CLI surface for NOMX code-intel operations
  nomx mcp-serve Launch an NOMX stdio MCP server target (plugin/runtime use)
  nomx help      Show this help message
  nomx status    Show active modes and state
  nomx cancel    Cancel active execution modes
  nomx reasoning Show or set model reasoning effort (low|medium|high|xhigh)

Options:
  --yolo        Launch Codex in yolo mode (shorthand for: nomx launch --yolo)
  --high        Launch Codex with high reasoning effort
                (shorthand for: -c model_reasoning_effort="high")
  --xhigh       Launch Codex with xhigh reasoning effort
                (shorthand for: -c model_reasoning_effort="xhigh")
  --madmax      DANGEROUS: bypass Codex approvals and sandbox
                (alias for --dangerously-bypass-approvals-and-sandbox)
  --spark       Use the Codex spark model (~1.3x faster)
  --madmax-spark  spark model for workers + bypass approvals for leader and workers
                (shorthand for: --spark --madmax)
  --notify-temp  Enable temporary notification routing for this run/session only
  --discord      Select Discord provider for temporary notification mode
  --slack        Select Slack provider for temporary notification mode
  --telegram     Select Telegram provider for temporary notification mode
  -w, --worktree[=<name>]
                Launch Codex in a git worktree (detached when no name is given)
  --force       Force reinstall (overwrite existing files)
  --merge-agents
                Merge NOMX-managed AGENTS.md sections and persist that explicit policy for this project root
  --no-merge-agents
                Persist an explicit non-merge policy; current non-merge behavior remains contextual
  --clear-merge-agents-policy
                Clear the persisted AGENTS merge policy for this project root
  --dry-run     Show what would be done without doing it
  --plugin      Use Codex plugin delivery for nomx setup and remove legacy NOMX-managed user/project components
  --legacy      Use legacy setup delivery for nomx setup, overriding persisted plugin mode
  --install-mode <legacy|plugin>
                Explicit setup install mode (canonical form; --legacy/--plugin are aliases)
  --mcp <none|compat>
                Explicit setup MCP mode (default: none; compat enables first-party MCP compatibility and shared registry sync)
  --no-mcp      Alias for --mcp=none
  --with-mcp    Alias for --mcp=compat
  --keep-config Skip config.toml cleanup during uninstall
  --purge       Remove .nomx/ cache directory during uninstall
  --verbose     Show detailed output
  --scope       Setup scope for "nomx setup" only:
                user | project

`;

const REASONING_KEY = "model_reasoning_effort";
const MODEL_INSTRUCTIONS_FILE_KEY = "model_instructions_file";
const NOMX_BYPASS_DEFAULT_SYSTEM_PROMPT_ENV = "NOMX_BYPASS_DEFAULT_SYSTEM_PROMPT";
const NOMX_MODEL_INSTRUCTIONS_FILE_ENV = "NOMX_MODEL_INSTRUCTIONS_FILE";
const NOMX_RALPH_APPEND_INSTRUCTIONS_FILE_ENV =
  "NOMX_RALPH_APPEND_INSTRUCTIONS_FILE";
const NOMX_AUTORESEARCH_APPEND_INSTRUCTIONS_FILE_ENV =
  "NOMX_AUTORESEARCH_APPEND_INSTRUCTIONS_FILE";
const REASONING_MODES = CANONICAL_REASONING_EFFORTS;
type ReasoningMode = (typeof REASONING_MODES)[number];
const REASONING_MODE_SET = new Set<string>(REASONING_MODES);
const REASONING_USAGE = "Usage: nomx reasoning <low|medium|high|xhigh>";
const AMBIGUOUS_REASONING_MESSAGE = 'Codex/NOMX canonical highest reasoning effort is "xhigh"; "max" and "ultra" are not accepted aliases.';


type CliCommand =
  | "launch"
  | "exec"
  | "setup"
  | "update"
  | "list"
  | "agents"
  | "agents-init"
  | "deepinit"
  | "uninstall"
  | "doctor"
  | "cleanup"
  | "resume"
  | "version"
  | "hooks"
  | "hud"
  | "state"
  | "notepad"
  | "project-memory"
  | "trace"
  | "code-intel"
  | "mcp-serve"
  | "status"
  | "cancel"
  | "help"
  | "reasoning"
  | "codex-native-hook"
  | string;

const NESTED_HELP_COMMANDS = new Set<CliCommand>([
  "cleanup",
  "agents",
  "agents-init",
  "autoresearch",
  "deepinit",
  "exec",
  "hooks",
  "list",
  "hud",
  "state",
  "notepad",
  "project-memory",
  "trace",
  "code-intel",
  "mcp-serve",
  "ralph",
  "ralplan",
  "ultragoal",
  "resume",
  "migrate",
]);

export interface ResolvedCliInvocation {
  command: CliCommand;
  launchArgs: string[];
}

export type SetupMergeAgentsPolicyArg =
  | { kind: "set"; value: boolean }
  | { kind: "clear" }
  | undefined;

export function resolveSetupAgentsMergePolicyArg(args: string[]): SetupMergeAgentsPolicyArg {
  let policy: SetupMergeAgentsPolicyArg;
  const setPolicy = (next: Exclude<SetupMergeAgentsPolicyArg, undefined>, source: string): void => {
    if (policy && (policy.kind !== next.kind || (policy.kind === "set" && next.kind === "set" && policy.value !== next.value))) {
      throw new Error(`Conflicting setup AGENTS merge policy flags: ${source} conflicts with another merge policy selector.`);
    }
    policy = next;
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--merge-agents" || arg === "--no-merge-agents" || arg === "--clear-merge-agents-policy") {
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        throw new Error(`Setup AGENTS merge policy flags do not accept values: ${arg} ${next}`);
      }
      if (arg === "--merge-agents") {
        setPolicy({ kind: "set", value: true }, arg);
      } else if (arg === "--no-merge-agents") {
        setPolicy({ kind: "set", value: false }, arg);
      } else {
        setPolicy({ kind: "clear" }, arg);
      }
    } else if (
      arg.startsWith("--merge-agents=") ||
      arg.startsWith("--no-merge-agents=") ||
      arg.startsWith("--clear-merge-agents-policy=")
    ) {
      throw new Error(`Setup AGENTS merge policy flags do not accept values: ${arg}`);
    }
  }
  return policy;
}

export function resolveSetupMergeAgentsArg(args: string[]): boolean | undefined {
  const policy = resolveSetupAgentsMergePolicyArg(args);
  return policy?.kind === "set" ? policy.value : undefined;
}

export function resolveSetupInstallModeArg(args: string[]): SetupInstallMode | undefined {
  let value: SetupInstallMode | undefined;
  const setValue = (next: SetupInstallMode, source: string): void => {
    if (value && value !== next) {
      throw new Error(
        `Conflicting setup install mode flags: ${source} selects ${next}, but another flag already selected ${value}`,
      );
    }
    value = next;
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--plugin") {
      setValue("plugin", arg);
      continue;
    }
    if (arg === "--legacy") {
      setValue("legacy", arg);
      continue;
    }
    if (arg === "--install-mode") {
      const next = args[index + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(
          `Missing setup install mode value after --install-mode. Expected one of: legacy, plugin`,
        );
      }
      if (next !== "legacy" && next !== "plugin") {
        throw new Error(
          `Invalid setup install mode: ${next}. Expected one of: legacy, plugin`,
        );
      }
      setValue(next, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--install-mode=")) {
      const next = arg.slice("--install-mode=".length);
      if (next !== "legacy" && next !== "plugin") {
        throw new Error(
          `Invalid setup install mode: ${next}. Expected one of: legacy, plugin`,
        );
      }
      setValue(next, "--install-mode");
    }
  }

  return value;
}


export function resolveSetupMcpModeArg(args: string[]): SetupMcpMode | undefined {
  let value: SetupMcpMode | undefined;
  const setValue = (next: SetupMcpMode, source: string): void => {
    if (value && value !== next) {
      throw new Error(
        `Conflicting setup MCP mode flags: ${source} selects ${next}, but another flag already selected ${value}`,
      );
    }
    value = next;
  };
  const parseValue = (next: string): SetupMcpMode => {
    if (!SETUP_MCP_MODES.includes(next as SetupMcpMode)) {
      throw new Error(
        `Invalid setup MCP mode: ${next}. Expected one of: none, compat`,
      );
    }
    return next as SetupMcpMode;
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-mcp") {
      setValue("none", arg);
      continue;
    }
    if (arg === "--with-mcp") {
      setValue("compat", arg);
      continue;
    }
    if (arg === "--mcp") {
      const next = args[index + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(
          `Missing setup MCP mode value after --mcp. Expected one of: none, compat`,
        );
      }
      setValue(parseValue(next), arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--mcp=")) {
      setValue(parseValue(arg.slice("--mcp=".length)), "--mcp");
    }
  }

  return value;
}

export function resolveSetupScopeArg(args: string[]): SetupScope | undefined {
  let value: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--scope") {
      const next = args[index + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(
          `Missing setup scope value after --scope. Expected one of: ${SETUP_SCOPES.join(", ")}`,
        );
      }
      value = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--scope=")) {
      value = arg.slice("--scope=".length);
    }
  }
  if (!value) return undefined;
  if (SETUP_SCOPES.includes(value as SetupScope)) {
    return value as SetupScope;
  }
  throw new Error(
    `Invalid setup scope: ${value}. Expected one of: ${SETUP_SCOPES.join(", ")}`,
  );
}

export function resolveCliInvocation(args: string[]): ResolvedCliInvocation {
  const firstArg = args[0];
  if (firstArg === "--help" || firstArg === "-h") {
    return { command: "help", launchArgs: [] };
  }
  if (firstArg === "--version" || firstArg === "-v") {
    return { command: "version", launchArgs: [] };
  }
  if (!firstArg || firstArg.startsWith("--")) {
    return { command: "launch", launchArgs: firstArg ? args : [] };
  }
  if (firstArg === "launch") {
    return { command: "launch", launchArgs: args.slice(1) };
  }
  if (firstArg === "exec") {
    return { command: "exec", launchArgs: args.slice(1) };
  }
  if (firstArg === "resume") {
    return { command: "resume", launchArgs: args.slice(1) };
  }
  return { command: firstArg, launchArgs: [] };
}

export function resolveUpdateChannelArg(args: string[]): UpdateChannel {
  let channel: UpdateChannel = 'stable';
  let sawStable = false;
  let sawDev = false;

  for (const arg of args) {
    if (arg === '--stable') {
      sawStable = true;
      channel = 'stable';
      continue;
    }
    if (arg === '--dev') {
      sawDev = true;
      channel = 'dev';
      continue;
    }
    throw new Error(
      `Unknown nomx update option: ${arg}. Expected no flags, --stable, or --dev.`,
    );
  }

  if (sawStable && sawDev) {
    throw new Error('nomx update --dev and --stable are mutually exclusive.');
  }

  return channel;
}

export function resolveNotifyTempContract(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): ParseNotifyTempContractResult {
  return parseNotifyTempContractFromArgs(args, env);
}

export function commandOwnsLocalHelp(command: CliCommand): boolean {
  return NESTED_HELP_COMMANDS.has(command);
}


type ExecFileSyncFailure = NodeJS.ErrnoException & {
  status?: number | null;
  signal?: NodeJS.Signals | null;
};



export interface PreparedCodexHomeForLaunch {
  codexHomeOverride?: string;
  sqliteHomeOverride?: string;
  projectLocalCodexHomeForCleanup?: string;
  runtimeCodexHomeForCleanup?: string;
}

export const CODEX_SQLITE_HOME_ENV = "CODEX_SQLITE_HOME";

export function runtimeCodexHomePath(
  cwd: string,
  sessionId: string,
): string {
  return join(nomxRoot(cwd), "runtime", "codex-home", sessionId);
}

async function linkOrCopyCodexHomeEntry(source: string, destination: string): Promise<void> {
  const stat = await lstat(source);
  try {
    await symlink(source, destination, stat.isDirectory() && process.platform === "win32" ? "junction" : undefined);
  } catch {
    if (stat.isDirectory()) {
      await cp(source, destination, { recursive: true, force: true, verbatimSymlinks: true });
      return;
    }
    await copyFile(source, destination);
  }
}

async function copyFilePreservingTimestamps(source: string, destination: string): Promise<void> {
  await copyFile(source, destination);
  const sourceStat = await stat(source);
  await utimes(destination, sourceStat.atime, sourceStat.mtime);
}

function isCodexSqliteArtifact(entryName: string): boolean {
  return /^(?:state|logs)_\d+\.sqlite(?:-(?:shm|wal))?$/.test(entryName);
}

const PROJECT_LAUNCH_PERSISTED_RUNTIME_ENTRY_NAMES = new Set([
  // Codex CLI writes browser/OTP login state here when CODEX_HOME points at
  // the per-session mirror. Persist only the opaque file itself; never parse or
  // log the contents.
  "auth.json",
]);

const PROJECT_LAUNCH_DURABLE_HISTORY_ENTRY_NAMES = new Set([
  "sessions",
  "history.jsonl",
  "session_index.jsonl",
]);

// Mirroring these files into the runtime CODEX_HOME would cause Codex to load
// them as user-scope config alongside the canonical project-scope copies under
// <cwd>/.codex, duplicating every native hook and asking the user to re-trust
// hooks on every launch. See GH issue #2470.
const PROJECT_LAUNCH_RUNTIME_SKIPPED_ENTRY_NAMES = new Set(["hooks.json"]);

function shouldMirrorProjectLaunchRuntimeEntry(entryName: string, includeHistoryArtifacts: boolean): boolean {
  if (PROJECT_LAUNCH_DURABLE_HISTORY_ENTRY_NAMES.has(entryName)) return true;
  if (isCodexSqliteArtifact(entryName)) return includeHistoryArtifacts;
  return true;
}

function shouldPersistProjectLaunchRuntimeEntry(entryName: string): boolean {
  return PROJECT_LAUNCH_PERSISTED_RUNTIME_ENTRY_NAMES.has(entryName);
}

function uniqueJsonlLines(contents: string): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of contents.split(/\r?\n/)) {
    if (line === "" || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines;
}

async function persistProjectLaunchRuntimeJsonlArtifact(source: string, destination: string): Promise<void> {
  const existing = existsSync(destination) ? await readFile(destination, "utf-8").catch(() => "") : "";
  const sourceContents = await readFile(source, "utf-8");
  const separator = existing === "" || existing.endsWith("\n") || sourceContents === "" ? "" : "\n";
  const lines = uniqueJsonlLines(`${existing}${separator}${sourceContents}`);
  await writeFile(destination, lines.length > 0 ? `${lines.join("\n")}\n` : "", "utf-8");
}

async function persistProjectLaunchRuntimeHistoryArtifacts(
  runtimeCodexHome: string | undefined,
  projectCodexHome: string | undefined,
): Promise<void> {
  if (!runtimeCodexHome || !projectCodexHome) return;
  if (!existsSync(runtimeCodexHome)) return;
  await mkdir(projectCodexHome, { recursive: true });

  for (const entryName of PROJECT_LAUNCH_DURABLE_HISTORY_ENTRY_NAMES) {
    const source = join(runtimeCodexHome, entryName);
    if (!existsSync(source)) continue;
    const sourceStat = await lstat(source);
    if (sourceStat.isSymbolicLink()) continue;
    const destination = join(projectCodexHome, entryName);
    if (sourceStat.isDirectory()) {
      await cp(source, destination, { recursive: true, force: true, preserveTimestamps: true, verbatimSymlinks: true });
      continue;
    }
    if (entryName === "history.jsonl" || entryName === "session_index.jsonl") {
      await persistProjectLaunchRuntimeJsonlArtifact(source, destination);
      continue;
    }
    if (sourceStat.isFile()) {
      await copyFilePreservingTimestamps(source, destination);
    }
  }
}

async function ensureProjectLaunchRuntimeHistoryLinks(
  runtimeCodexHome: string,
  projectCodexHome: string,
): Promise<void> {
  await mkdir(projectCodexHome, { recursive: true });
  for (const entryName of PROJECT_LAUNCH_DURABLE_HISTORY_ENTRY_NAMES) {
    const runtimeEntry = join(runtimeCodexHome, entryName);
    if (existsSync(runtimeEntry)) continue;
    const projectEntry = join(projectCodexHome, entryName);
    if (entryName === "sessions") {
      await mkdir(projectEntry, { recursive: true });
    } else if (!existsSync(projectEntry)) {
      await writeFile(projectEntry, "");
    }
    await linkOrCopyCodexHomeEntry(projectEntry, runtimeEntry);
  }
}

async function materializeProjectLaunchRuntimeHistoryEntries(
  runtimeCodexHome: string,
  sourceCodexHome: string,
): Promise<void> {
  for (const entryName of PROJECT_LAUNCH_DURABLE_HISTORY_ENTRY_NAMES) {
    const source = join(sourceCodexHome, entryName);
    if (!existsSync(source)) continue;
    const destination = join(runtimeCodexHome, entryName);
    await rm(destination, { recursive: true, force: true });
    const sourceStat = await lstat(source);
    if (sourceStat.isDirectory()) {
      await cp(source, destination, { recursive: true, force: true, dereference: true, preserveTimestamps: true });
      continue;
    }
    await copyFilePreservingTimestamps(source, destination);
  }
}

async function mergeProjectLaunchRuntimeHistoryEntries(
  runtimeCodexHome: string,
  sourceCodexHome: string,
  mergedHistorySourceRealpaths: Set<string>,
): Promise<void> {
  for (const entryName of PROJECT_LAUNCH_DURABLE_HISTORY_ENTRY_NAMES) {
    const source = join(sourceCodexHome, entryName);
    if (!existsSync(source)) continue;
    const sourceRealpath = realpathSync(source);
    if (mergedHistorySourceRealpaths.has(sourceRealpath)) continue;
    const destination = join(runtimeCodexHome, entryName);
    const sourceStat = await stat(source);
    if (sourceStat.isDirectory()) {
      await mkdir(destination, { recursive: true });
      await cp(source, destination, { recursive: true, force: true, dereference: true, preserveTimestamps: true });
      mergedHistorySourceRealpaths.add(sourceRealpath);
      continue;
    }
    if (entryName === "sessions") continue;
    if (!sourceStat.isFile()) continue;
    if (existsSync(destination)) {
      const destinationStat = await stat(destination);
      if (!destinationStat.isFile()) {
        await rm(destination, { recursive: true, force: true });
        await copyFilePreservingTimestamps(source, destination);
        mergedHistorySourceRealpaths.add(sourceRealpath);
        continue;
      }
      const existing = await readFile(destination, "utf-8").catch(() => "");
      const addition = await readFile(source, "utf-8");
      const separator = existing === "" || existing.endsWith("\n") || addition === "" ? "" : "\n";
      await writeFile(destination, `${existing}${separator}${addition}`, "utf-8");
      mergedHistorySourceRealpaths.add(sourceRealpath);
      continue;
    }
    await copyFilePreservingTimestamps(source, destination);
    mergedHistorySourceRealpaths.add(sourceRealpath);
  }
}

export async function persistProjectLaunchRuntimeAuthState(
  runtimeCodexHome: string | undefined,
  projectCodexHome: string | undefined,
): Promise<void> {
  if (!runtimeCodexHome || !projectCodexHome) return;
  if (!existsSync(runtimeCodexHome)) return;
  await mkdir(projectCodexHome, { recursive: true });

  for (const entry of await readdir(runtimeCodexHome, { withFileTypes: true })) {
    if (!shouldPersistProjectLaunchRuntimeEntry(entry.name) || !entry.isFile()) continue;
    await copyFile(join(runtimeCodexHome, entry.name), join(projectCodexHome, entry.name));
  }
}

/**
 * Project-scope setup keeps durable Codex config under <repo>/.codex, but the
 * Codex TUI also stores model-availability NUX counters in CODEX_HOME/config.toml.
 * Launch against a session mirror so those runtime writes never dirty the
 * durable project config while preserving the project config as the launch input.
 */
export interface PrepareRuntimeCodexHomeForProjectLaunchOptions {
  includeHistoryArtifacts?: boolean;
  extraHistoryCodexHomes?: string[];
}

export async function prepareRuntimeCodexHomeForProjectLaunch(
  cwd: string,
  sessionId: string,
  projectCodexHome: string,
  options: PrepareRuntimeCodexHomeForProjectLaunchOptions = {},
): Promise<string> {
  const runtimeCodexHome = runtimeCodexHomePath(cwd, sessionId);
  await rm(runtimeCodexHome, { recursive: true, force: true });
  await mkdir(runtimeCodexHome, { recursive: true });

  if (!existsSync(projectCodexHome)) {
    await ensureProjectLaunchRuntimeHistoryLinks(runtimeCodexHome, projectCodexHome);
    return runtimeCodexHome;
  }

  for (const entry of await readdir(projectCodexHome, { withFileTypes: true })) {
    if (!shouldMirrorProjectLaunchRuntimeEntry(entry.name, options.includeHistoryArtifacts === true)) continue;
    if (PROJECT_LAUNCH_RUNTIME_SKIPPED_ENTRY_NAMES.has(entry.name)) continue;
    const source = join(projectCodexHome, entry.name);
    const destination = join(runtimeCodexHome, entry.name);
    if (entry.name === "config.toml") {
      const projectHooksPath = join(projectCodexHome, "hooks.json");
      const projectConfig = await readFile(source, "utf-8");
      const launchConfig = repairProjectScopeTrustStateForLaunch(
        projectConfig,
        projectHooksPath,
      );
      if (launchConfig !== projectConfig) {
        await writeFile(source, launchConfig, "utf-8");
      }
      await writeFile(destination, launchConfig, "utf-8");
      continue;
    }
    await linkOrCopyCodexHomeEntry(source, destination);
  }
  await ensureProjectLaunchRuntimeHistoryLinks(runtimeCodexHome, projectCodexHome);
  if (options.includeHistoryArtifacts === true && (options.extraHistoryCodexHomes?.length ?? 0) > 0) {
    const mergedHistorySourceRealpaths = new Set<string>();
    for (const entryName of PROJECT_LAUNCH_DURABLE_HISTORY_ENTRY_NAMES) {
      const source = join(projectCodexHome, entryName);
      if (existsSync(source)) mergedHistorySourceRealpaths.add(realpathSync(source));
    }
    await materializeProjectLaunchRuntimeHistoryEntries(runtimeCodexHome, projectCodexHome);
    for (const extraCodexHome of options.extraHistoryCodexHomes ?? []) {
      await mergeProjectLaunchRuntimeHistoryEntries(runtimeCodexHome, extraCodexHome, mergedHistorySourceRealpaths);
    }
  }


  return runtimeCodexHome;
}

function resolveProjectSqliteHomeForLaunch(
  projectCodexHome: string,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const configured = env[CODEX_SQLITE_HOME_ENV];
  if (typeof configured === "string" && configured.trim() !== "") return undefined;
  return projectCodexHome;
}

export interface PrepareCodexHomeForLaunchOptions {
  includeHistoryArtifacts?: boolean;
  extraHistoryCodexHomes?: string[];
}

export async function prepareCodexHomeForLaunch(
  cwd: string,
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
  options: PrepareCodexHomeForLaunchOptions = {},
): Promise<PreparedCodexHomeForLaunch> {
  const projectLocalCodexHomeForCleanup = resolveProjectLocalCodexHomeForLaunch(cwd, env);
  if (projectLocalCodexHomeForCleanup) {
    const runtimeCodexHome = await prepareRuntimeCodexHomeForProjectLaunch(
      cwd,
      sessionId,
      projectLocalCodexHomeForCleanup,
      { includeHistoryArtifacts: options.includeHistoryArtifacts, extraHistoryCodexHomes: options.extraHistoryCodexHomes },
    );
    return {
      codexHomeOverride: runtimeCodexHome,
      sqliteHomeOverride: resolveProjectSqliteHomeForLaunch(projectLocalCodexHomeForCleanup, env),
      projectLocalCodexHomeForCleanup,
      runtimeCodexHomeForCleanup: runtimeCodexHome,
    };
  }

  return {
    codexHomeOverride: resolveCodexHomeForLaunch(cwd, env),
    projectLocalCodexHomeForCleanup,
  };
}

export interface ResumeCodexHomeSelection {
  args: string[];
  explicitCodexHome?: string;
  projectOnly: boolean;
}

export function parseResumeCodexHomeSelection(args: string[]): ResumeCodexHomeSelection {
  const nextArgs: string[] = [];
  let explicitCodexHome: string | undefined;
  let projectOnly = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--codex-home") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value after --codex-home.");
      }
      explicitCodexHome = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--codex-home=")) {
      explicitCodexHome = arg.slice("--codex-home=".length);
      if (explicitCodexHome.trim() === "") {
        throw new Error("Missing value after --codex-home.");
      }
      continue;
    }
    if (arg === "--project") {
      projectOnly = true;
      continue;
    }
    nextArgs.push(arg);
  }

  return {
    args: nextArgs,
    explicitCodexHome,
    projectOnly,
  };
}

export interface ResumePluginPreflightResult {
  status: "unavailable" | "skipped" | "prepared";
  version?: string;
  cacheDir?: string;
  prunedStaleDirs: string[];
  configUpdated: boolean;
}

export interface ResumePluginPreflightOptions {
  projectRoot?: string;
}

async function shouldPreflightResumeOmxPluginState(
  selectedCodexHomeDir: string,
  existingConfig: string,
  options: ResumePluginPreflightOptions,
): Promise<boolean> {
  if (hasLocalOmxPluginEnablement(existingConfig)) return true;
  if (
    options.projectRoot &&
    readPersistedSetupPreferences(options.projectRoot)?.installMode === "plugin"
  ) {
    return true;
  }
  return (await discoverOmxPluginCacheDirs(selectedCodexHomeDir)).length > 0;
}

export async function preflightResumeOmxPluginState(
  codexHomeDir: string | undefined,
  pkgRoot = getPackageRoot(),
  options: ResumePluginPreflightOptions = {},
): Promise<ResumePluginPreflightResult> {
  const selectedCodexHomeDir = codexHomeDir && codexHomeDir.trim() !== ""
    ? codexHomeDir
    : join(homedir(), ".codex");
  const configPath = join(selectedCodexHomeDir, "config.toml");
  const existingConfig = existsSync(configPath) ? await readFile(configPath, "utf-8") : "";
  if (!(await shouldPreflightResumeOmxPluginState(selectedCodexHomeDir, existingConfig, options))) {
    return { status: "skipped", prunedStaleDirs: [], configUpdated: false };
  }

  const packagedMarketplace = await resolvePackagedOmxMarketplace(pkgRoot);
  if (!packagedMarketplace) {
    return { status: "unavailable", prunedStaleDirs: [], configUpdated: false };
  }

  const materialized = await materializePackagedOmxPluginCache(selectedCodexHomeDir, packagedMarketplace);
  const version = materialized.version ?? (await packagedOmxPluginVersion(packagedMarketplace)) ?? undefined;
  const currentCacheDir = materialized.cacheDir ?? (version ? join(selectedCodexHomeDir, "plugins", "cache", "nomx-local", "nomx", version) : undefined);
  const prunedStaleDirs: string[] = [];

  const nextConfig = upsertLocalOmxMarketplaceRegistration(
    upsertLocalOmxPluginEnablement(existingConfig),
    pkgRoot,
  );
  const configUpdated = nextConfig !== existingConfig;
  if (configUpdated) {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, nextConfig, "utf-8");
  }

  return {
    status: "prepared",
    version,
    cacheDir: currentCacheDir,
    prunedStaleDirs,
    configUpdated,
  };
}

function isResumeCodexLaunch(args: string[]): boolean {
  return args.includes("resume");
}

async function prepareResumeCodexHomeForLaunch(
  cwd: string,
  sessionId: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ args: string[]; prepared: PreparedCodexHomeForLaunch }> {
  const selection = parseResumeCodexHomeSelection(args);
  if (selection.explicitCodexHome) {
    const codexHomeOverride = resolve(selection.explicitCodexHome);
    await preflightResumeOmxPluginState(codexHomeOverride, getPackageRoot(), { projectRoot: cwd });
    return {
      args: selection.args,
      prepared: {
        codexHomeOverride,
      },
    };
  }

  const projectHomes = await discoverProjectRuntimeCodexHomes(cwd);
  if (selection.projectOnly) {
    if (projectHomes.length === 0) {
      const emptyRuntimeCodexHome = runtimeCodexHomePath(cwd, sessionId);
      await rm(emptyRuntimeCodexHome, { recursive: true, force: true });
      await mkdir(join(emptyRuntimeCodexHome, "sessions"), { recursive: true });
      await preflightResumeOmxPluginState(emptyRuntimeCodexHome, getPackageRoot(), { projectRoot: cwd });
      return {
        args: selection.args,
        prepared: {
          codexHomeOverride: emptyRuntimeCodexHome,
          runtimeCodexHomeForCleanup: emptyRuntimeCodexHome,
        },
      };
    }
    const runtimeCodexHome = await prepareRuntimeCodexHomeForProjectLaunch(cwd, sessionId, projectHomes[0].path, {
      includeHistoryArtifacts: true,
      extraHistoryCodexHomes: projectHomes.slice(1).map((home) => home.path),
    });
    await preflightResumeOmxPluginState(runtimeCodexHome, getPackageRoot(), { projectRoot: cwd });
    return {
      args: selection.args,
      prepared: {
        codexHomeOverride: runtimeCodexHome,
      },
    };
  }

  const prepared = await prepareCodexHomeForLaunch(cwd, sessionId, env, {
    includeHistoryArtifacts: true,
    extraHistoryCodexHomes: projectHomes.map((home) => home.path),
  });
  await preflightResumeOmxPluginState(prepared.codexHomeOverride, getPackageRoot(), { projectRoot: cwd });
  return { args: selection.args, prepared };
}

export async function persistProjectLaunchRuntimeProjectTrustState(
  runtimeCodexHome: string | undefined,
  projectCodexHome: string | undefined,
): Promise<void> {
  if (!runtimeCodexHome || !projectCodexHome) return;
  const runtimeConfigPath = join(runtimeCodexHome, "config.toml");
  if (!existsSync(runtimeConfigPath)) return;
  const projectConfigPath = join(projectCodexHome, "config.toml");
  const runtimeConfig = await readFile(runtimeConfigPath, "utf-8");
  const projectConfig = existsSync(projectConfigPath)
    ? await readFile(projectConfigPath, "utf-8")
    : "";
  const projectHooksPath = join(projectCodexHome, "hooks.json");
  const nextProjectConfig = syncProjectScopeTrustStateFromRuntime(
    projectConfig,
    runtimeConfig,
    projectHooksPath,
  );
  if (nextProjectConfig !== projectConfig) {
    await mkdir(projectCodexHome, { recursive: true });
    await writeFile(projectConfigPath, nextProjectConfig, "utf-8");
  }
}

export async function cleanupRuntimeCodexHome(
  runtimeCodexHomeForCleanup?: string,
  projectCodexHomeForPersistence?: string,
): Promise<void> {
  if (!runtimeCodexHomeForCleanup) return;
  await persistProjectLaunchRuntimeAuthState(
    runtimeCodexHomeForCleanup,
    projectCodexHomeForPersistence,
  );
  await persistProjectLaunchRuntimeHistoryArtifacts(
    runtimeCodexHomeForCleanup,
    projectCodexHomeForPersistence,
  );
  await persistProjectLaunchRuntimeProjectTrustState(
    runtimeCodexHomeForCleanup,
    projectCodexHomeForPersistence,
  );
  await rm(runtimeCodexHomeForCleanup, { recursive: true, force: true });
}













function hasErrnoCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code,
  );
}



function logCliOperationFailure(error: unknown): void {
  process.stderr.write(`[cli/index] operation failed: ${error}
`);
}












export interface CodexExecFailureClassification {
  kind: "exit" | "launch-error";
  code?: string;
  message: string;
  exitCode?: number;
  signal?: NodeJS.Signals;
}

export function resolveSignalExitCode(
  signal: NodeJS.Signals | null | undefined,
): number {
  if (!signal) return 1;
  const signalNumber = osConstants.signals[signal];
  if (typeof signalNumber === "number" && Number.isFinite(signalNumber)) {
    return 128 + signalNumber;
  }
  return 1;
}

export function classifyCodexExecFailure(
  error: unknown,
): CodexExecFailureClassification {
  if (!error || typeof error !== "object") {
    return {
      kind: "launch-error",
      message: String(error),
    };
  }

  const err = error as ExecFileSyncFailure;
  const code = typeof err.code === "string" ? err.code : undefined;
  const message =
    typeof err.message === "string" && err.message.length > 0
      ? err.message
      : "unknown codex launch failure";
  const hasExitStatus = typeof err.status === "number";
  const hasSignal = typeof err.signal === "string" && err.signal.length > 0;

  if (hasExitStatus || hasSignal) {
    return {
      kind: "exit",
      code,
      message,
      exitCode: hasExitStatus
        ? (err.status as number)
        : resolveSignalExitCode(err.signal),
      signal: hasSignal ? (err.signal as NodeJS.Signals) : undefined,
    };
  }

  return {
    kind: "launch-error",
    code,
    message,
  };
}

export async function resolveLaunchConfigRepairOptions(
  cwd: string,
  configPath: string,
): Promise<{
  includeFirstPartyMcp: boolean;
  sharedMcpServers?: UnifiedMcpRegistryServer[];
  sharedMcpRegistrySource?: string;
}> {
  let content: string | undefined;
  const readConfig = async (): Promise<string | undefined> => {
    if (content !== undefined) return content;
    if (!existsSync(configPath)) return undefined;
    content = await readFile(configPath, "utf-8");
    return content;
  };

  const existingContent = await readConfig();
  const sharedMcpRegistry = existingContent
    ? extractSharedMcpRegistryServersFromConfig(existingContent)
    : { servers: [] };
  const sharedMcpOptions =
    sharedMcpRegistry.servers.length > 0
      ? {
          sharedMcpServers: sharedMcpRegistry.servers,
          sharedMcpRegistrySource: sharedMcpRegistry.sourcePath,
        }
      : {};

  if (readPersistedSetupPreferences(cwd)?.mcpMode === "compat") {
    return { includeFirstPartyMcp: true, ...sharedMcpOptions };
  }

  if (existingContent) {
    const hasExistingFirstPartyMcp = NOMX_FIRST_PARTY_MCP_SERVER_NAMES.some((name) =>
      new RegExp(`^\\s*\\[mcp_servers\\.${name}\\]\\s*$`, "m").test(existingContent),
    );
    if (hasExistingFirstPartyMcp || sharedMcpRegistry.servers.length > 0) {
      return { includeFirstPartyMcp: hasExistingFirstPartyMcp, ...sharedMcpOptions };
    }
  }

  return {
    includeFirstPartyMcp: false,
  };
}

function runCodexBlocking(
  cwd: string,
  launchArgs: string[],
  codexEnv: NodeJS.ProcessEnv,
): void {
  const { result } = spawnPlatformCommandSync("codex", launchArgs, {
    cwd,
    stdio: "inherit",
    env: codexEnv,
    encoding: "utf-8",
  });

  if (result.error) {
    const errno = result.error as NodeJS.ErrnoException;
    const kind = classifySpawnError(errno);
    if (kind === "missing") {
      console.error(
        "[nomx] failed to launch codex: executable not found in PATH",
      );
    } else if (kind === "blocked") {
      console.error(
        `[nomx] failed to launch codex: executable is present but blocked in the current environment (${errno.code || "blocked"})`,
      );
    } else {
      console.error(`[nomx] failed to launch codex: ${errno.message}`);
    }
    throw result.error;
  }

  if (result.status !== 0) {
    process.exitCode =
      typeof result.status === "number"
        ? result.status
        : resolveSignalExitCode(result.signal);
    if (result.signal) {
      console.error(`[nomx] codex exited due to signal ${result.signal}`);
    } else if (typeof result.status === "number") {
      console.error(`[nomx] codex exited with code ${result.status}`);
    }
  }
}

export function nomxRuntimeCommandShimFileName(
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32" ? "nomx.cmd" : "nomx";
}

export function nomxRuntimeCommandShimPath(
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(nomxRoot(cwd), "runtime", "bin", nomxRuntimeCommandShimFileName(platform));
}

function ensureRuntimeShimDirectory(path: string): void {
  if (existsSync(path)) {
    const current = lstatSync(path);
    if (current.isSymbolicLink()) {
      throw new Error(`Refusing to create NOMX runtime command shim through symlink directory: ${path}`);
    }
    if (!current.isDirectory()) {
      throw new Error(`Refusing to create NOMX runtime command shim because path is not a directory: ${path}`);
    }
    return;
  }
  mkdirSync(path, { mode: 0o700 });
}

function buildOmxRuntimeCommandShim(
  nodePath: string,
  nomxBin: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    return [
      "@echo off",
      `"${nodePath}" "${nomxBin}" %*`,
      "",
    ].join("\r\n");
  }
  return [
    "#!/bin/sh",
    `exec ${quoteShellArg(nodePath)} ${quoteShellArg(nomxBin)} "$@"`,
    "",
  ].join("\n");
}

export function ensureOmxRuntimeCommandShim(
  cwd: string,
  nomxBin: string,
  nodePath: string = process.execPath,
  platform: NodeJS.Platform = process.platform,
): string {
  const shimPath = nomxRuntimeCommandShimPath(cwd, platform);
  const shimDir = dirname(shimPath);
  const rootDir = nomxRoot(cwd);
  const runtimeDir = dirname(shimDir);
  ensureRuntimeShimDirectory(rootDir);
  ensureRuntimeShimDirectory(runtimeDir);
  ensureRuntimeShimDirectory(shimDir);
  if (existsSync(shimPath)) {
    const current = lstatSync(shimPath);
    if (current.isDirectory()) {
      throw new Error(`Refusing to replace NOMX runtime command shim directory: ${shimPath}`);
    }
    if (current.isSymbolicLink()) {
      rmSync(shimPath, { force: true });
    }
  }
  writeFileSync(shimPath, buildOmxRuntimeCommandShim(nodePath, nomxBin, platform), {
    encoding: "utf-8",
    mode: 0o700,
  });
  if (platform !== "win32") {
    chmodSync(shimPath, 0o700);
  }
  return shimDir;
}

export function prependOmxRuntimeCommandShimToEnv(
  cwd: string,
  env: NodeJS.ProcessEnv,
  nomxBin: string,
  nodePath: string = process.execPath,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const shimDir = ensureOmxRuntimeCommandShim(cwd, nomxBin, nodePath, platform);
  const pathDelimiter = platform === "win32" ? win32.delimiter : posix.delimiter;
  const result: NodeJS.ProcessEnv = { ...env };

  if (platform === "win32") {
    // Windows env var names are case-insensitive; the inherited key is usually
    // `Path`, not `PATH`. Find every case variant, preserve the existing value,
    // prepend the shim directory, and collapse to a single key so the child does
    // not see an empty `PATH` shadowing the real `Path` (which drops System32,
    // WindowsPowerShell, etc.).
    const pathVariants = Object.keys(result).filter(
      (key) => key.toLowerCase() === "path",
    );
    let pathKey = "Path";
    let currentPath = "";
    for (const variant of pathVariants) {
      const value = result[variant];
      if (typeof value === "string" && value.length > 0) {
        pathKey = variant;
        currentPath = value;
        break;
      }
    }
    for (const variant of pathVariants) {
      delete result[variant];
    }
    result[pathKey] = currentPath
      ? `${shimDir}${pathDelimiter}${currentPath}`
      : shimDir;
  } else {
    const currentPath = typeof result.PATH === "string" ? result.PATH : "";
    result.PATH = currentPath ? `${shimDir}${pathDelimiter}${currentPath}` : shimDir;
  }

  result.NOMX_ENTRY_PATH = nomxBin;
  result.NOMX_STARTUP_CWD =
    typeof result.NOMX_STARTUP_CWD === "string" && result.NOMX_STARTUP_CWD.trim()
      ? result.NOMX_STARTUP_CWD
      : cwd;
  return result;
}


export function buildHudPaneCleanupTargets(
  existingPaneIds: string[],
  createdPaneId: string | null,
  leaderPaneId?: string,
): string[] {
  const targets = new Set<string>(
    existingPaneIds.filter((id) => id.startsWith("%")),
  );
  if (createdPaneId && createdPaneId.startsWith("%")) {
    targets.add(createdPaneId);
  }
  // Guard: never kill the leader's own pane under any circumstances.
  if (leaderPaneId && leaderPaneId.startsWith("%")) {
    targets.delete(leaderPaneId);
  }
  return [...targets];
}

function isCrossPlatformAbsolutePath(raw: string): boolean {
  return posix.isAbsolute(raw) || win32.isAbsolute(raw);
}

export function resolveOmxRootForLaunch(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.NOMX_ROOT || env.NOMX_STATE_ROOT;
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  return isCrossPlatformAbsolutePath(raw) ? raw : join(cwd, raw);
}
type HudRuntimeRootSource = 'team-env' | 'nomx-root-env' | 'nomx-state-root-env' | 'cwd-default';

interface HudRuntimeRootForLaunch {
  nomxRoot?: string;
  nomxStateRoot?: string;
  nomxTeamStateRoot?: string;
  rootSource: HudRuntimeRootSource;
}

function resolveLaunchPath(cwd: string, raw: string): string {
  return isCrossPlatformAbsolutePath(raw) ? raw : join(cwd, raw);
}


export function resolveHudRuntimeRootForLaunch(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): HudRuntimeRootForLaunch {
  const nomxTeamStateRoot = env.NOMX_TEAM_STATE_ROOT?.trim();
  if (nomxTeamStateRoot) {
    return {
      nomxTeamStateRoot: resolveLaunchPath(cwd, nomxTeamStateRoot),
      rootSource: 'team-env',
    };
  }

  const nomxRoot = env.NOMX_ROOT?.trim();
  if (nomxRoot) {
    return {
      nomxRoot: resolveLaunchPath(cwd, nomxRoot),
      rootSource: 'nomx-root-env',
    };
  }

  const nomxStateRoot = env.NOMX_STATE_ROOT?.trim();
  if (nomxStateRoot) {
    return {
      nomxStateRoot: resolveLaunchPath(cwd, nomxStateRoot),
      rootSource: 'nomx-state-root-env',
    };
  }

  return { rootSource: 'cwd-default' };
}

function hasExplicitOmxRootEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return [env.NOMX_ROOT, env.NOMX_STATE_ROOT].some(
    (value) => typeof value === "string" && value.trim() !== "",
  );
}

export function resolveDisposableWorktreeOmxRootForLaunch(
  ensuredWorktree: { enabled: true; repoRoot: string } | { enabled: false } | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!ensuredWorktree?.enabled) return undefined;
  if (hasExplicitOmxRootEnv(env)) return undefined;
  return ensuredWorktree.repoRoot;
}

interface MadmaxWorktreeRuntimeContext {
  nomxRoot: string;
  nomxStateRoot?: string;
  sourceCwd: string;
  worktreeCwd?: string;
  madmaxDetachedContext?: string;
  boxedActive?: true;
}

function buildMadmaxWorktreeRuntimeEnvOverlay(
  runtimeContext?: MadmaxWorktreeRuntimeContext,
): NodeJS.ProcessEnv {
  if (!runtimeContext) return {};
  return {
    NOMX_ROOT: runtimeContext.nomxRoot,
    ...(runtimeContext.nomxStateRoot ? { NOMX_STATE_ROOT: runtimeContext.nomxStateRoot } : {}),
    ...(runtimeContext.boxedActive ? { OMXBOX_ACTIVE: "1" } : {}),
    NOMX_SOURCE_CWD: runtimeContext.sourceCwd,
    ...(runtimeContext.madmaxDetachedContext
      ? { [NOMX_MADMAX_DETACHED_CONTEXT_ENV]: runtimeContext.madmaxDetachedContext }
      : {}),
  };
}

export function captureMadmaxWorktreeRuntimeContext(options: {
  originalLaunchArgs: readonly string[];
  worktreeEnabled: boolean;
  sourceCwd: string;
  worktreeCwd?: string;
  env?: NodeJS.ProcessEnv;
}): MadmaxWorktreeRuntimeContext | undefined {
  const env = options.env ?? process.env;
  if (!options.worktreeEnabled) return undefined;
  if (!launchArgsRequestMadmaxIsolation(options.originalLaunchArgs)) return undefined;
  if (env.OMXBOX_ACTIVE !== "1") return undefined;

  const inheritedRoot = resolveInheritedMadmaxRoot(env);
  if (!inheritedRoot) return undefined;

  const sourceCwd = env.NOMX_SOURCE_CWD?.trim() || options.sourceCwd;
  const worktreeCwd = options.worktreeCwd?.trim();
  const nomxStateRoot = env.NOMX_STATE_ROOT?.trim();
  const madmaxDetachedContext = env[NOMX_MADMAX_DETACHED_CONTEXT_ENV]?.trim();

  return {
    nomxRoot: resolveLaunchPath(options.sourceCwd, inheritedRoot),
    ...(nomxStateRoot ? { nomxStateRoot: resolveLaunchPath(options.sourceCwd, nomxStateRoot) } : {}),
    sourceCwd,
    ...(worktreeCwd && worktreeCwd !== sourceCwd ? { worktreeCwd } : {}),
    ...(madmaxDetachedContext ? { madmaxDetachedContext } : {}),
    boxedActive: true,
  };
}

function launchArgsRequestMadmaxIsolation(launchArgs: readonly string[]): boolean {
  return launchArgs.some(
    (arg) => arg === MADMAX_FLAG || arg === MADMAX_SPARK_FLAG,
  );
}


export function shouldAutoIsolateMadmaxLaunch(
  command: string,
  launchArgs: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): boolean {
  if (command !== "launch" && command !== "exec") return false;
  if (env.NOMX_NO_BOX === "1") return false;
  if (!launchArgsRequestMadmaxIsolation(launchArgs)) return false;
  const inheritedContext = env[NOMX_MADMAX_DETACHED_CONTEXT_ENV]?.trim();
  if (env.OMXBOX_ACTIVE === "1" && inheritedContext && !resolveInheritedMadmaxRoot(env)) {
    return false;
  }
  if (madmaxInheritedContextMatchesLaunch(cwd, launchArgs, env)) return false;
  return true;
}

function sanitizeRunIdSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

const MADMAX_DETACHED_ACTIVE_DIR = "active-detached";
const MADMAX_DETACHED_LOCK_STALE_MS = 30_000;
const MADMAX_DETACHED_LOCK_RETRY_MS = 50;
const MADMAX_DETACHED_LOCK_MAX_ATTEMPTS = 100;
const NOMX_MADMAX_DETACHED_CONTEXT_ENV = "NOMX_MADMAX_DETACHED_CONTEXT";

interface MadmaxDetachedLockRetryOptions {
  maxAttempts?: number;
  retryMs?: number;
}

interface MadmaxDetachedLockOwner {
  version: 1;
  pid: number;
  context_key: string;
  acquired_at: string;
}

interface MadmaxDetachedLockInspection {
  stale: boolean;
  diagnostic: string;
}


function resolveMadmaxRunsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.NOMX_RUNS_DIR || join(homedir(), ".nomx-runs");
}

function canonicalizeLaunchCwd(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || cwd;
  } catch {
    return cwd;
  }
}


export function buildMadmaxDetachedLaunchContextKey(
  sourceCwd: string,
  argv: readonly string[],
  runIdentity = "",
): string {
  // The boxed run root is part of the lock identity for auto-isolated madmax
  // launches. That lets independent `nomx --madmax --high` sessions share the
  // same source cwd/argv without contending on one active-detached lock, while
  // callers that intentionally reuse the same boxed context keep one key.
  const payload = JSON.stringify({
    source_cwd: canonicalizeLaunchCwd(sourceCwd),
    argv: [...argv],
    run_identity: runIdentity,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}





function readMadmaxDetachedLockOwner(lockPath: string): MadmaxDetachedLockOwner | null {
  try {
    const parsed = JSON.parse(readFileSync(join(lockPath, "owner.json"), "utf-8")) as Partial<MadmaxDetachedLockOwner>;
    if (
      parsed.version !== 1 ||
      typeof parsed.pid !== "number" ||
      !Number.isSafeInteger(parsed.pid) ||
      parsed.pid <= 0 ||
      typeof parsed.context_key !== "string" ||
      typeof parsed.acquired_at !== "string"
    ) {
      return null;
    }
    return {
      version: 1,
      pid: parsed.pid,
      context_key: parsed.context_key,
      acquired_at: parsed.acquired_at,
    };
  } catch {
    return null;
  }
}

function readMadmaxDetachedLockPid(lockPath: string): number | null {
  const owner = readMadmaxDetachedLockOwner(lockPath);
  if (owner) return owner.pid;
  try {
    const holderPid = Number.parseInt(readFileSync(join(lockPath, "pid"), "utf-8").trim(), 10);
    return Number.isSafeInteger(holderPid) && holderPid > 0 ? holderPid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function inspectMadmaxDetachedContextLock(lockPath: string): MadmaxDetachedLockInspection {
  const lockStat = statSync(lockPath, { throwIfNoEntry: false });
  if (!lockStat) {
    return { stale: false, diagnostic: "lock disappeared while waiting" };
  }
  const ageMs = Math.max(0, Date.now() - lockStat.mtimeMs);
  const owner = readMadmaxDetachedLockOwner(lockPath);
  const holderPid = owner?.pid ?? readMadmaxDetachedLockPid(lockPath);
  if (holderPid) {
    if (!isProcessAlive(holderPid)) {
      return {
        stale: true,
        diagnostic: `stale holder pid ${holderPid} is not running; lock age ${Math.round(ageMs)}ms`,
      };
    }
    const ownerContext = owner ? `, owner context ${owner.context_key}` : ", legacy pid-only lock";
    const sameDirectoryGuidance =
      "Another madmax detached launch is active for this directory; close the existing madmax session or use --worktree for concurrent work. Multiple madmax sessions in one directory are unsafe";
    return {
      stale: false,
      diagnostic: `holder pid ${holderPid} is still running${ownerContext}; lock age ${Math.round(ageMs)}ms. ${sameDirectoryGuidance}`,
    };
  }
  if (ageMs > MADMAX_DETACHED_LOCK_STALE_MS) {
    return {
      stale: true,
      diagnostic: `legacy lock has no readable owner pid and is older than ${MADMAX_DETACHED_LOCK_STALE_MS}ms; lock age ${Math.round(ageMs)}ms`,
    };
  }
  return {
    stale: false,
    diagnostic: `lock has no readable owner pid yet; lock age ${Math.round(ageMs)}ms`,
  };
}

export function withMadmaxDetachedContextLock<T>(
  runsRoot: string,
  contextKey: string,
  run: () => T,
  options: MadmaxDetachedLockRetryOptions = {},
): T {
  const lockPath = join(runsRoot, MADMAX_DETACHED_ACTIVE_DIR, `${contextKey}.lock`);
  const maxAttempts = options.maxAttempts ?? MADMAX_DETACHED_LOCK_MAX_ATTEMPTS;
  const retryMs = options.retryMs ?? MADMAX_DETACHED_LOCK_RETRY_MS;
  let lastDiagnostic = "lock was busy";
  mkdirSync(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      mkdirSync(lockPath);
      try {
        const owner: MadmaxDetachedLockOwner = {
          version: 1,
          pid: process.pid,
          context_key: contextKey,
          acquired_at: new Date().toISOString(),
        };
        writeFileSync(join(lockPath, "owner.json"), `${JSON.stringify(owner, null, 2)}\n`, { mode: 0o600 });
        writeFileSync(join(lockPath, "pid"), String(process.pid));
        return run();
      } finally {
        rmSync(lockPath, { recursive: true, force: true });
      }
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as NodeJS.ErrnoException).code)
          : "";
      if (code !== "EEXIST") throw err;
      const inspection = inspectMadmaxDetachedContextLock(lockPath);
      lastDiagnostic = inspection.diagnostic;
      if (inspection.stale) {
        rmSync(lockPath, { recursive: true, force: true });
        continue;
      }
      blockMs(retryMs);
    }
  }
  throw new MadmaxDetachedGuardError(
    `timed out waiting for madmax detached launch context lock: ${lockPath} (${lastDiagnostic})`,
  );
}

function readMadmaxRunMetadata(
  runRoot: string,
): { cwd?: string; detached_launch_context?: string } | null {
  try {
    const parsed = JSON.parse(readFileSync(join(runRoot, ".nomxbox-run.json"), "utf-8")) as {
      cwd?: unknown;
      detached_launch_context?: unknown;
    };
    return {
      ...(typeof parsed.cwd === "string" ? { cwd: parsed.cwd } : {}),
      ...(typeof parsed.detached_launch_context === "string"
        ? { detached_launch_context: parsed.detached_launch_context }
        : {}),
    };
  } catch {
    return null;
  }
}

function resolveInheritedMadmaxRoot(env: NodeJS.ProcessEnv): string | undefined {
  const root = env.NOMX_ROOT?.trim() || env.NOMX_STATE_ROOT?.trim();
  return root || undefined;
}

function madmaxInheritedContextMatchesLaunch(
  cwd: string,
  launchArgs: readonly string[],
  env: NodeJS.ProcessEnv,
): boolean {
  if (env.OMXBOX_ACTIVE !== "1") return false;
  const context = env[NOMX_MADMAX_DETACHED_CONTEXT_ENV]?.trim();
  if (!context) return false;
  const inheritedRoot = resolveInheritedMadmaxRoot(env);
  if (!inheritedRoot) return false;
  const metadata = readMadmaxRunMetadata(inheritedRoot);
  if (!metadata) return false;
  if (metadata.cwd && metadata.cwd !== inheritedRoot) return false;
  if (metadata.detached_launch_context !== context) return false;
  const expectedContext = buildMadmaxDetachedLaunchContextKey(cwd, [...launchArgs], inheritedRoot);
  return expectedContext === context;
}




class MadmaxDetachedGuardError extends Error {
  readonly failClosed = true;
}

export function createMadmaxIsolatedRoot(
  sourceCwd: string,
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): string {
  const runsRoot = resolveMadmaxRunsRoot(env);
  mkdirSync(runsRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const suffix = Math.random().toString(16).slice(2, 6);
  const runDir = join(runsRoot, sanitizeRunIdSegment(`run-${stamp}-${suffix}`));
  mkdirSync(runDir, { recursive: false });
  const detachedLaunchContext = buildMadmaxDetachedLaunchContextKey(sourceCwd, argv, runDir);

  const metadata = {
    launcher: "nomx --madmax",
    created_at: new Date().toISOString(),
    cwd: runDir,
    source_cwd: sourceCwd,
    argv,
    detached_launch_context: detachedLaunchContext,
  };
  writeFileSync(join(runDir, ".nomxbox-run.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  writeFileSync(join(runsRoot, "registry.jsonl"), `${JSON.stringify(metadata)}\n`, { flag: "a" });
  env[NOMX_MADMAX_DETACHED_CONTEXT_ENV] = detachedLaunchContext;
  return runDir;
}

function activateMadmaxIsolationIfNeeded(
  command: string,
  launchArgs: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!shouldAutoIsolateMadmaxLaunch(command, launchArgs, env, cwd)) return;
  const runDir = createMadmaxIsolatedRoot(cwd, launchArgs, env);
  env.NOMX_ROOT = runDir;
  env.OMXBOX_ACTIVE = "1";
  env.NOMX_SOURCE_CWD = cwd;
  process.stderr.write(`[nomx] madmax isolated state: ${runDir} (source: ${cwd})\n`);
}

export async function main(args: string[]): Promise<void> {
  const knownCommands = new Set([
    "launch",
    "exec",
    "setup",
    "update",
    "list",
    "agents",
    "agents-init",
    "deepinit",
    "uninstall",
    "doctor",
    "migrate",
    "cleanup",
    "ralph",
    "ralplan",
    "ultragoal",
    "resume",
    "version",
    "hooks",
    "hud",
    "state",
    "mcp-serve",
    "status",
    "cancel",
    "help",
    "--help",
    "-h",
  ]);
  const firstArg = args[0];
  const { command, launchArgs } = resolveCliInvocation(args);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const options = {
    force: flags.has("--force"),
    mergeAgents: undefined,
    dryRun: flags.has("--dry-run"),
    verbose: flags.has("--verbose"),
  };

  if (flags.has("--help") && !commandOwnsLocalHelp(command)) {
    console.log(HELP);
    return;
  }

  activateMadmaxIsolationIfNeeded(command, launchArgs, process.cwd(), process.env);

  try {
    switch (command) {
      case "launch":
        await launchWithHud(launchArgs);
        break;
      case "resume":
        await launchWithHud(["resume", ...launchArgs]);
        break;
      case "setup":
        await setup({
          force: options.force,
          mergeAgents: options.mergeAgents,
          mergeAgentsPolicy: resolveSetupAgentsMergePolicyArg(args.slice(1)),
          dryRun: options.dryRun,
          verbose: options.verbose,
          scope: resolveSetupScopeArg(args.slice(1)),
          installMode: resolveSetupInstallModeArg(args.slice(1)),
          mcpMode: resolveSetupMcpModeArg(args.slice(1)),
        });
        break;
      case "update":
        await runImmediateUpdate(process.cwd(), {}, { channel: resolveUpdateChannelArg(args.slice(1)) });
        break;
      case "list":
        await listCommand(args.slice(1));
        break;
      case "agents":
        await agentsCommand(args.slice(1));
        break;
      case "agents-init":
        await agentsInitCommand(args.slice(1));
        break;
      case "deepinit":
        await agentsInitCommand(args.slice(1));
        break;
      case "uninstall":
        await uninstall({
          dryRun: options.dryRun,
          keepConfig: flags.has("--keep-config"),
          verbose: options.verbose,
          purge: flags.has("--purge"),
          scope: resolveSetupScopeArg(args.slice(1)),
        });
        break;
      case "doctor": {
        const { doctor } = await import("./doctor.js");
        await doctor(options);
        break;
      }
      case "migrate": {
        const { migrateCommand } = await import("./migrate.js");
        await migrateCommand(args.slice(1));
        break;
      }
      case "cleanup":
        await cleanupCommand(args.slice(1));
        break;
      case "exec":
        if (launchArgs[0] === "inject") {
          await execInjectCommand(launchArgs);
        } else {
          await execWithOverlay(launchArgs);
        }
        break;
      case "ralph":
        await ralphCommand(args.slice(1));
        break;
      case "ralplan":
        await ralplanCommand(args.slice(1));
        break;
      case "ultragoal":
        await ultragoalCommand(args.slice(1));
        break;
      case "version":
        version();
        break;
      case "hud":
        await hudCommand(args.slice(1));
        break;
      case "state":
        await stateCommand(args.slice(1));
        break;
      case "notepad":
        await mcpParityCommand("notepad", args.slice(1));
        break;
      case "project-memory":
        await mcpParityCommand("project-memory", args.slice(1));
        break;
      case "trace":
        await mcpParityCommand("trace", args.slice(1));
        break;
      case "code-intel":
        await mcpParityCommand("code-intel", args.slice(1));
        break;
      case "mcp-serve":
        await mcpServeCommand(args.slice(1));
        break;
      case "hooks":
        await hooksCommand(args.slice(1));
        break;
      case "status":
        await showStatus();
        break;
      case "cancel":
        await cancelModes(args.slice(1));
        break;
      case "reasoning":
        await reasoningCommand(args.slice(1));
        break;
      case "codex-native-hook": {
        const { runCodexNativeHookCli } = await import("../scripts/codex-native-hook.js");
        await runCodexNativeHookCli();
        break;
      }
      case "help":
      case "--help":
      case "-h":
        console.log(HELP);
        break;
      default:
        if (
          firstArg &&
          firstArg.startsWith("-") &&
          !knownCommands.has(firstArg)
        ) {
          await launchWithHud(args);
          break;
        }
        console.error(`Unknown command: ${command}`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

type StaleCurrentAutopilotStatus = {
  phase: string;
};

function sanitizedStatusString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

async function readStaleCurrentAutopilotStatus(cwd: string): Promise<StaleCurrentAutopilotStatus | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(getBaseStateDir(cwd), "current-autopilot.json"), "utf-8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const state = parsed as Record<string, unknown>;
  if (state.active !== true) return null;
  const phase = sanitizedStatusString(state.current_phase) ?? sanitizedStatusString(state.currentPhase);
  const sessionId = sanitizedStatusString(state.session_id) ?? sanitizedStatusString(state.sessionId);
  if (!phase && !sessionId) return null;
  return { phase: phase ?? "active" };
}

function formatDurableUltragoalStatusForCli(status: string): string {
  return status === "failed"
    ? "ultragoal: FAILED (phase: failed)"
    : `ultragoal: ACTIVE (phase: ${status})`;
}

async function showStatus(): Promise<void> {
  const { readFile } = await import("fs/promises");
  const cwd = process.cwd();
  try {
    let refs = await listModeStateFilesWithScopePreference(cwd);
    // Reconcile with hook-visible run-dir state when the worktree-scoped state
    // list reports no active workflow mode (parity with `nomx cancel`). This
    // surfaces detached/madmax sessions whose state lives under the run dir.
    const hasActiveWorkflowMode = async (candidate: ModeStateFileRef[]): Promise<boolean> => {
      for (const ref of candidate) {
        const mode = basename(ref.path).replace("-state.json", "");
        if (mode === SKILL_ACTIVE_STATE_MODE) continue;
        try {
          const parsed = JSON.parse(await readFile(ref.path, "utf-8")) as Record<string, unknown>;
          if (parsed.active === true) return true;
        } catch {
          continue;
        }
      }
      return false;
    };
    let hasAuthoritativeActiveMode = await hasActiveWorkflowMode(refs);
    if (!hasAuthoritativeActiveMode) {
      const runDirRefs = await listHookVisibleRunDirStateRefs(cwd);
      if (await hasActiveWorkflowMode(runDirRefs)) {
        refs = runDirRefs;
        hasAuthoritativeActiveMode = true;
      }
    }
    const states = refs.map((ref) => ref.path);
    const ultragoalState = await readUltragoalState(cwd).catch(() => null);
    if (states.length === 0) {
      if (ultragoalState?.active) {
        console.log(formatDurableUltragoalStatusForCli(ultragoalState.status ?? "active"));
        return;
      }
      const staleAutopilot = await readStaleCurrentAutopilotStatus(cwd);
      if (staleAutopilot) {
        console.log(`autopilot: STALE (phase: ${staleAutopilot.phase})`);
        return;
      }
      console.log("No active modes.");
      return;
    }
    let hasAuthoritativeActiveUltragoalMode = false;
    for (const path of states) {
      const content = await readFile(path, "utf-8");
      let state: Record<string, unknown>;
      try {
        state = JSON.parse(content) as Record<string, unknown>;
      } catch (err) {
        logCliOperationFailure(err);
        continue;
      }
      const file = basename(path);
      const mode = file.replace("-state.json", "");
      if (mode === "ultragoal" && state.active === true) {
        hasAuthoritativeActiveUltragoalMode = true;
      }
      if (mode === "ultragoal" && ultragoalState?.active && state.active !== true) continue;
      console.log(
        `${mode}: ${state.active === true ? "ACTIVE" : "inactive"} (phase: ${String(state.current_phase || "n/a")})`,
      );
    }
    if (ultragoalState?.active && !hasAuthoritativeActiveUltragoalMode) {
      console.log(formatDurableUltragoalStatusForCli(ultragoalState.status ?? "active"));
    }
    if (!hasAuthoritativeActiveMode && !ultragoalState?.active) {
      const staleAutopilot = await readStaleCurrentAutopilotStatus(cwd);
      if (staleAutopilot) {
        console.log(`autopilot: STALE (phase: ${staleAutopilot.phase})`);
      }
    }
  } catch (err) {
    logCliOperationFailure(err);
    console.log("No active modes.");
  }
}

async function reasoningCommand(args: string[]): Promise<void> {
  const mode = args[0];
  const configPath = codexConfigPath();

  if (!mode) {
    if (!existsSync(configPath)) {
      console.log(
        `model_reasoning_effort is not set (${configPath} does not exist).`,
      );
      console.log(REASONING_USAGE);
      return;
    }

    const { readFile } = await import("fs/promises");
    const content = await readFile(configPath, "utf-8");
    const current = readTopLevelTomlString(content, REASONING_KEY);
    if (current) {
      console.log(`Current ${REASONING_KEY}: ${current}`);
      return;
    }

    console.log(`${REASONING_KEY} is not set in ${configPath}.`);
    console.log(REASONING_USAGE);
    return;
  }

  if (!REASONING_MODE_SET.has(mode)) {
    const guidance = isAmbiguousUnsupportedReasoningEffort(mode)
      ? `${AMBIGUOUS_REASONING_MESSAGE}\n`
      : "";
    throw new Error(
      `${guidance}Invalid reasoning mode "${mode}". Expected one of: ${REASONING_MODES.join(", ")}.\n${REASONING_USAGE}`,
    );
  }

  const { mkdir, readFile, writeFile } = await import("fs/promises");
  await mkdir(dirname(configPath), { recursive: true });

  const existing = existsSync(configPath)
    ? await readFile(configPath, "utf-8")
    : "";
  const updated = upsertTopLevelTomlString(existing, REASONING_KEY, mode);
  await writeFile(configPath, updated);
  console.log(`Set ${REASONING_KEY}="${mode}" in ${configPath}`);
}

export async function launchWithHud(args: string[]): Promise<void> {
  const launchCwd = process.cwd();
  const notifyTempResult = resolveNotifyTempContract(
    args,
    process.env,
  );
  const enableNotifyFallbackAuthority = true;
  let normalizedArgs = normalizeCodexLaunchArgs(
    notifyTempResult.passthroughArgs,
  );
  const cwd = launchCwd;
  const worktreeDirty = false;

  const sessionId = `nomx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await maybeCheckAndPromptUpdate(cwd);
  } catch (err) {
    logCliOperationFailure(err);
    // Non-fatal: update checks must never block launch
  }

  try {
    await maybePromptGithubStar();
  } catch (err) {
    logCliOperationFailure(err);
    // Non-fatal: star prompt must never block launch
  }

  // ── Phase 0.5: config repair ────────────────────────────────────────────
  // After an nomx version upgrade the OLD setup code (still in memory) may
  // have written a config.toml with duplicate [tui] sections.  Codex CLI's
  // TOML parser rejects duplicates, so we repair before spawning the CLI.
  try {
    const configPath = resolveCodexConfigPathForLaunch(launchCwd, process.env);
    const repaired = await repairConfigIfNeeded(
      configPath,
      getPackageRoot(),
      await resolveLaunchConfigRepairOptions(launchCwd, configPath),
    );
    if (repaired) {
      console.log("[nomx] Repaired managed config.toml compatibility issue.");
    }
  } catch {
    // Non-fatal: repair failure must not block launch
  }

  const resumePrepared = isResumeCodexLaunch(normalizedArgs)
    ? await prepareResumeCodexHomeForLaunch(launchCwd, sessionId, normalizedArgs, process.env)
    : null;
  if (resumePrepared) {
    normalizedArgs = resumePrepared.args;
  }
  const preparedCodexHome = resumePrepared?.prepared ?? await prepareCodexHomeForLaunch(launchCwd, sessionId, process.env, {
    includeHistoryArtifacts: isResumeCodexLaunch(normalizedArgs),
  });
  const codexHomeOverride = preparedCodexHome.codexHomeOverride;
  const sqliteHomeOverride = preparedCodexHome.sqliteHomeOverride;
  const projectLocalCodexHomeForCleanup = preparedCodexHome.projectLocalCodexHomeForCleanup;

  // ── Phase 1: preLaunch ──────────────────────────────────────────────────
  try {
    await preLaunch(cwd, sessionId, notifyTempResult.contract, codexHomeOverride, enableNotifyFallbackAuthority, worktreeDirty);
  } catch (err) {
    if (isSessionPointerLaunchAbort(err)) {
      console.error(`[nomx] session pointer launch aborted: ${err.code}`);
      await cleanupRuntimeCodexHome(
        preparedCodexHome.runtimeCodexHomeForCleanup,
        projectLocalCodexHomeForCleanup,
      ).catch((cleanupErr) => {
        console.error(
          `[nomx] preLaunch abort cleanup warning: ${cleanupErr instanceof Error ? cleanupErr.message : cleanupErr}`,
        );
      });
      throw err;
    }
    // preLaunch errors after pointer commit must not prevent Codex from starting.
    console.error(
      `[nomx] preLaunch warning: ${err instanceof Error ? err.message : err}`,
    );
  }

  // ── Phase 2: run ────────────────────────────────────────────────────────
  let postLaunchHandledExternally = false;
  try {
    const notifyTempContractRaw = notifyTempResult.contract.active
      ? serializeNotifyTempContract(notifyTempResult.contract)
      : null;
    const launchResult = runCodex(
      cwd,
      normalizedArgs,
      sessionId,
      undefined,
      codexHomeOverride,
      sqliteHomeOverride,
      notifyTempContractRaw,
      "direct",
      projectLocalCodexHomeForCleanup,
      preparedCodexHome.runtimeCodexHomeForCleanup,
      undefined,
    );
    postLaunchHandledExternally = launchResult.postLaunchHandledExternally;
  } finally {
    // ── Phase 3: postLaunch ─────────────────────────────────────────────
    if (!postLaunchHandledExternally) {
      await postLaunch(cwd, sessionId, codexHomeOverride, enableNotifyFallbackAuthority, projectLocalCodexHomeForCleanup);
      await cleanupRuntimeCodexHome(preparedCodexHome.runtimeCodexHomeForCleanup, projectLocalCodexHomeForCleanup).catch(logCliOperationFailure);
    }
  }
}

export async function execWithOverlay(args: string[]): Promise<void> {
  const launchCwd = process.cwd();
  const notifyTempResult = resolveNotifyTempContract(
    args,
    process.env,
  );
  const normalizedArgs = normalizeCodexLaunchArgs(
    notifyTempResult.passthroughArgs,
  );
  const cwd = launchCwd;
  const worktreeDirty = false;

  const sessionId = `nomx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    await maybeCheckAndPromptUpdate(cwd);
  } catch (err) {
    logCliOperationFailure(err);
  }

  try {
    await maybePromptGithubStar();
  } catch (err) {
    logCliOperationFailure(err);
  }

  try {
    const configPath = resolveCodexConfigPathForLaunch(launchCwd, process.env);
    const repaired = await repairConfigIfNeeded(
      configPath,
      getPackageRoot(),
      await resolveLaunchConfigRepairOptions(launchCwd, configPath),
    );
    if (repaired) {
      console.log("[nomx] Repaired managed config.toml compatibility issue.");
    }
  } catch {
    // Non-fatal
  }

  const preparedCodexHome = await prepareCodexHomeForLaunch(launchCwd, sessionId, process.env);
  const codexHomeOverride = preparedCodexHome.codexHomeOverride;
  const sqliteHomeOverride = preparedCodexHome.sqliteHomeOverride;
  const projectLocalCodexHomeForCleanup = preparedCodexHome.projectLocalCodexHomeForCleanup;

  try {
    await preLaunch(cwd, sessionId, notifyTempResult.contract, codexHomeOverride, true, worktreeDirty);
  } catch (err) {
    if (isSessionPointerLaunchAbort(err)) {
      console.error(`[nomx] session pointer launch aborted: ${err.code}`);
      await cleanupRuntimeCodexHome(
        preparedCodexHome.runtimeCodexHomeForCleanup,
        projectLocalCodexHomeForCleanup,
      ).catch((cleanupErr) => {
        console.error(
          `[nomx] preLaunch abort cleanup warning: ${cleanupErr instanceof Error ? cleanupErr.message : cleanupErr}`,
        );
      });
      throw err;
    }
    console.error(
      `[nomx] preLaunch warning: ${err instanceof Error ? err.message : err}`,
    );
  }

  try {
    const notifyTempContractRaw = notifyTempResult.contract.active
      ? serializeNotifyTempContract(notifyTempResult.contract)
      : null;
    const codexArgs = injectModelInstructionsBypassArgs(
      cwd,
      ["exec", ...normalizedArgs],
      process.env,
      sessionModelInstructionsPath(cwd, sessionId),
    );
    const nomxRootOverride = resolveOmxRootForLaunch(cwd, process.env);
    const codexEnvBase = {
      ...process.env,
      ...(codexHomeOverride ? { CODEX_HOME: codexHomeOverride } : {}),
      ...(sqliteHomeOverride ? { [CODEX_SQLITE_HOME_ENV]: sqliteHomeOverride } : {}),
      ...(nomxRootOverride ? { NOMX_ROOT: nomxRootOverride } : {}),
    };
    const codexEnv = notifyTempContractRaw
      ? {
          ...codexEnvBase,
          [NOMX_NOTIFY_TEMP_CONTRACT_ENV]: notifyTempContractRaw,
        }
      : codexEnvBase;
    runCodexBlocking(cwd, codexArgs, codexEnv);
  } finally {
    await postLaunch(cwd, sessionId, codexHomeOverride, true, projectLocalCodexHomeForCleanup);
    await cleanupRuntimeCodexHome(preparedCodexHome.runtimeCodexHomeForCleanup, projectLocalCodexHomeForCleanup).catch(logCliOperationFailure);
  }
}

export function normalizeCodexLaunchArgs(args: string[]): string[] {
  const normalized: string[] = [];
  let wantsBypass = false;
  let hasBypass = false;
  let reasoningMode: ReasoningMode | null = null;

  for (const arg of args) {
    if (arg === MADMAX_FLAG) {
      wantsBypass = true;
      continue;
    }

    if (arg === CODEX_BYPASS_FLAG) {
      wantsBypass = true;
      if (!hasBypass) {
        normalized.push(arg);
        hasBypass = true;
      }
      continue;
    }

    if (arg === HIGH_REASONING_FLAG) {
      reasoningMode = "high";
      continue;
    }

    if (arg === XHIGH_REASONING_FLAG) {
      reasoningMode = "xhigh";
      continue;
    }

    if (arg === "--max" || arg === "--ultra") {
      throw new Error(AMBIGUOUS_REASONING_MESSAGE);
    }

    if (arg === SPARK_FLAG) {
      // Spark model is injected into worker env only (not the leader). Consume flag.
      continue;
    }

    if (arg === MADMAX_SPARK_FLAG) {
      // Bypass applies to leader; spark model goes to workers only. Consume flag.
      wantsBypass = true;
      continue;
    }

    normalized.push(arg);
  }

  if (wantsBypass && !hasBypass) {
    normalized.push(CODEX_BYPASS_FLAG);
  }

  if (reasoningMode) {
    normalized.push(CONFIG_FLAG, `${REASONING_KEY}="${reasoningMode}"`);
  }

  return normalized;
}

function isModelInstructionsOverride(value: string): boolean {
  return new RegExp(`^${MODEL_INSTRUCTIONS_FILE_KEY}\\s*=`).test(value.trim());
}

function hasModelInstructionsOverride(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === CONFIG_FLAG || arg === LONG_CONFIG_FLAG) {
      const maybeValue = args[i + 1];
      if (
        typeof maybeValue === "string" &&
        isModelInstructionsOverride(maybeValue)
      ) {
        return true;
      }
      continue;
    }

    if (arg.startsWith(`${LONG_CONFIG_FLAG}=`)) {
      const inlineValue = arg.slice(`${LONG_CONFIG_FLAG}=`.length);
      if (isModelInstructionsOverride(inlineValue)) return true;
    }
  }
  return false;
}

function shouldBypassDefaultSystemPrompt(env: NodeJS.ProcessEnv): boolean {
  return env[NOMX_BYPASS_DEFAULT_SYSTEM_PROMPT_ENV] !== "0";
}

function buildModelInstructionsOverride(
  cwd: string,
  env: NodeJS.ProcessEnv,
  defaultFilePath?: string,
): string {
  const filePath =
    env[NOMX_MODEL_INSTRUCTIONS_FILE_ENV] ||
    defaultFilePath ||
    join(cwd, "AGENTS.md");
  return `${MODEL_INSTRUCTIONS_FILE_KEY}="${escapeTomlString(filePath)}"`;
}

function tryReadGitValue(cwd: string, args: string[]): string | undefined {
  try {
    const value = execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function extractIssueNumber(text: string): number | undefined {
  const explicit = text.match(/\bissue\s*#(\d+)\b/i);
  if (explicit) return Number.parseInt(explicit[1], 10);
  const generic = text.match(/(^|[^\w/])#(\d+)\b/);
  return generic ? Number.parseInt(generic[2], 10) : undefined;
}





function buildNativeHookBaseContext(
  cwd: string,
  sessionId: string,
  normalizedEvent:
    | "started"
    | "blocked"
    | "run.heartbeat"
    | "run.blocked_on_user"
    | "run.blocked_on_system"
    | "finished"
    | "failed",
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const repoPath =
    tryReadGitValue(cwd, ["rev-parse", "--show-toplevel"]) || cwd;
  const branch = tryReadGitValue(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const issueNumber = extractIssueNumber(
    [branch, basename(cwd)].filter(Boolean).join(" "),
  );

  return {
    normalized_event: normalizedEvent,
    session_name: sessionId,
    repo_path: repoPath,
    repo_name: basename(repoPath),
    worktree_path: cwd,
    ...(branch ? { branch } : {}),
    ...(issueNumber !== undefined ? { issue_number: issueNumber } : {}),
    ...extra,
  };
}

export function injectModelInstructionsBypassArgs(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  defaultFilePath?: string,
): string[] {
  if (!shouldBypassDefaultSystemPrompt(env)) return [...args];
  if (hasModelInstructionsOverride(args)) return [...args];
  return [
    ...args,
    CONFIG_FLAG,
    buildModelInstructionsOverride(cwd, env, defaultFilePath),
  ];
}

export { readTopLevelTomlString, upsertTopLevelTomlString } from "../utils/toml.js";











function blockMs(ms: number): void {
  const delay = Math.max(1, Math.floor(ms));
  const shared = new SharedArrayBuffer(4);
  const view = new Int32Array(shared);
  Atomics.wait(view, 0, 0, delay);
}


async function readLaunchAppendInstructions(): Promise<string> {
  const appendixCandidates = [
    process.env[NOMX_RALPH_APPEND_INSTRUCTIONS_FILE_ENV]?.trim(),
    process.env[NOMX_AUTORESEARCH_APPEND_INSTRUCTIONS_FILE_ENV]?.trim(),
  ].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (appendixCandidates.length === 0) return "";
  const appendixPath = appendixCandidates[0];
  if (!existsSync(appendixPath)) {
    throw new Error(`launch instructions file not found: ${appendixPath}`);
  }
  const { readFile } = await import("fs/promises");
  return (await readFile(appendixPath, "utf-8")).trim();
}


function stripHermesMcpBridgeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { NOMX_HERMES_MCP_BRIDGE: _bridge, ...rest } = env;
  return rest;
}



export function buildNotifyTempStartupMessages(
  contract: NotifyTempContract,
  hasValidProviders: boolean,
): { infoLines: string[]; warningLines: string[] } {
  const providers =
    contract.canonicalSelectors.length > 0
      ? contract.canonicalSelectors.join(",")
      : "none";
  const infoLines = [
    `notify temp: active | providers=${providers} | persistent-routing=bypassed`,
  ];
  const warningLines = [...contract.warnings];
  if (!hasValidProviders) {
    warningLines.push(
      "notify temp: no valid providers resolved; notifications skipped",
    );
  }
  return { infoLines, warningLines };
}

export function buildNotifyFallbackWatcherEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: {
    codexHomeOverride?: string;
    nomxRootOverride?: string;
    enableAuthority?: boolean;
    sessionId?: string;
  } = {},
): NodeJS.ProcessEnv {
  const nextEnv = { ...env };
  return {
    ...nextEnv,
    ...(options.codexHomeOverride ? { CODEX_HOME: options.codexHomeOverride } : {}),
    ...(options.nomxRootOverride ? { NOMX_ROOT: options.nomxRootOverride } : {}),
    ...(options.sessionId ? { NOMX_SESSION_ID: options.sessionId } : {}),
    NOMX_HUD_AUTHORITY: options.enableAuthority ? "1" : "0",
  };
}

export function shouldEnableNotifyFallbackWatcher(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const toggle = String(env.NOMX_NOTIFY_FALLBACK ?? "").trim();
  if (platform === "win32") {
    return toggle === "1";
  }
  return toggle !== "0";
}

export async function cleanupLaunchOrphanedMcpProcesses(
  dependencies: CleanupDependencies = {},
): Promise<CleanupResult> {
  return cleanupNomxMcpProcesses([], {
    ...dependencies,
    selectCandidates: dependencies.selectCandidates ?? findLaunchSafeCleanupCandidates,
    writeLine: dependencies.writeLine ?? (() => {}),
  });
}

interface PostLaunchCleanupDependencies {
  cleanup?: () => Promise<CleanupResult>;
  writeInfo?: (line: string) => void;
  writeWarn?: (line: string) => void;
  writeError?: (line: string) => void;
}

interface PostLaunchModeCleanupDependencies {
  readdir?: typeof import("fs/promises").readdir;
  readFile?: typeof import("fs/promises").readFile;
  writeFile?: typeof import("fs/promises").writeFile;
  sleep?: (ms: number) => Promise<void>;
  writeWarn?: (line: string) => void;
  now?: () => Date;
}

type PostLaunchModeStateReadResult =
  | { kind: "ok"; state: Record<string, unknown> }
  | { kind: "missing" | "recoverable" }
  | { kind: "malformed"; message: string };

const POST_LAUNCH_MODE_STATE_RETRY_DELAY_MS = 10;
const POST_LAUNCH_MODE_STATE_MAX_READ_ATTEMPTS = 2;

function isLikelyTransientModeStateParseFailure(raw: string, err: unknown): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return true;
  if (!(err instanceof SyntaxError)) return false;
  if (!trimmed.startsWith("{") || trimmed.endsWith("}")) return false;
  return (
    /Unexpected end of JSON input/.test(err.message) ||
    /Unterminated string in JSON/.test(err.message) ||
    /Expected double-quoted property name in JSON/.test(err.message) ||
    /Expected property name or '}' in JSON/.test(err.message) ||
    /Expected ':' after property name in JSON/.test(err.message) ||
    /Expected ',' or '}' after property value in JSON/.test(err.message)
  );
}

async function readPostLaunchModeStateFile(
  path: string,
  dependencies: Pick<PostLaunchModeCleanupDependencies, "readFile" | "sleep"> = {},
): Promise<PostLaunchModeStateReadResult> {
  const readFile =
    dependencies.readFile ?? (await import("fs/promises")).readFile;
  const sleep =
    dependencies.sleep
    ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= POST_LAUNCH_MODE_STATE_MAX_READ_ATTEMPTS; attempt += 1) {
    try {
      const raw = await readFile(path, "utf-8");
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        if (attempt < POST_LAUNCH_MODE_STATE_MAX_READ_ATTEMPTS) {
          await sleep(POST_LAUNCH_MODE_STATE_RETRY_DELAY_MS);
          continue;
        }
        return { kind: "recoverable" };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch (err) {
        if (isLikelyTransientModeStateParseFailure(raw, err)) {
          if (attempt < POST_LAUNCH_MODE_STATE_MAX_READ_ATTEMPTS) {
            await sleep(POST_LAUNCH_MODE_STATE_RETRY_DELAY_MS);
            continue;
          }
          return { kind: "recoverable" };
        }
        return {
          kind: "malformed",
          message: err instanceof Error ? err.message : String(err),
        };
      }

      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        return { kind: "malformed", message: "mode state must be a JSON object" };
      }
      return { kind: "ok", state: parsed as Record<string, unknown> };
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error?.code === "ENOENT") return { kind: "missing" };
      return {
        kind: "malformed",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { kind: "recoverable" };
}

function cleanPostLaunchString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isAutopilotReviewPendingPostLaunchState(state: Record<string, unknown> | null): boolean {
  if (!state || state.active !== true) return false;
  const mode = cleanPostLaunchString(state.mode).toLowerCase();
  if (mode && mode !== "autopilot") return false;
  const phase = cleanPostLaunchString(state.current_phase ?? state.currentPhase)
    .toLowerCase()
    .replace(/_/g, "-");
  if (phase === "code-review" || phase === "review" || phase === "reviewing" || phase === "review-pending") {
    return true;
  }
  const nestedState = state.state && typeof state.state === "object"
    ? state.state as Record<string, unknown>
    : {};
  return state.review_pending === true
    || state.reviewPending === true
    || nestedState.review_pending === true
    || nestedState.reviewPending === true;
}

function postLaunchUniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function scrubPostLaunchRootSkillActiveForSession(
  stateDir: string,
  sessionId: string,
  nowIso: string,
  writeFileFn: typeof import("fs/promises").writeFile,
  rootStateBeforeCleanup?: SkillActiveStateLike | null,
): Promise<void> {
  const normalizedSessionId = cleanPostLaunchString(sessionId);
  if (!normalizedSessionId) return;

  const { rootPath } = getSkillActiveStatePathsForStateDir(stateDir);
  const rootState = rootStateBeforeCleanup ?? await readSkillActiveState(rootPath);
  if (!rootState) return;

  const rootSessionIds = postLaunchUniqueStrings([
    cleanPostLaunchString(rootState.session_id),
    cleanPostLaunchString(extractSessionIdFromInitializedStatePath(rootState.initialized_state_path)),
  ]);
  const rootBelongsToSession = rootSessionIds.includes(normalizedSessionId);
  const entries = listActiveSkills(rootState);
  const keptEntries = entries.filter((entry) => {
    const entrySessionId = cleanPostLaunchString(entry.session_id);
    if (entrySessionId) return entrySessionId !== normalizedSessionId;
    return !rootBelongsToSession;
  });

  if (keptEntries.length === entries.length && rootState.active !== true) return;
  if (keptEntries.length === entries.length && !rootBelongsToSession) return;

  const nextRoot = {
    ...rootState,
    active: keptEntries.length > 0,
    skill: keptEntries[0]?.skill ?? (keptEntries.length > 0 ? cleanPostLaunchString(rootState.skill) : ""),
    phase: keptEntries[0]?.phase ?? (keptEntries.length > 0 ? cleanPostLaunchString(rootState.phase) : "complete"),
    updated_at: nowIso,
    active_skills: keptEntries,
    post_launch_reconciled_at: nowIso,
    post_launch_reconciliation_reason: "terminal_session_cleanup",
  };
  await writeFileFn(rootPath, JSON.stringify(nextRoot, null, 2));
}

function buildRecoveredPostLaunchModeState(
  mode: string,
  completedAt: string,
): Record<string, unknown> {
  return {
    active: false,
    mode,
    current_phase: "cancelled",
    completed_at: completedAt,
    last_turn_at: completedAt,
  };
}

function buildRecoveredPostLaunchSkillActiveState(
  completedAt: string,
): Record<string, unknown> {
  return {
    version: 1,
    active: false,
    skill: "",
    phase: "complete",
    updated_at: completedAt,
    active_skills: [],
  };
}

function markRalphCompletionAuditBlockedForPostLaunch(
  state: Record<string, unknown>,
  cwd: string,
  nowIso: string,
): boolean {
  if (!isRalphCompletePhase(state.current_phase ?? state.currentPhase)) return false;
  const audit = evaluateRalphCompletionAuditEvidence(state, cwd);
  if (audit.complete) return false;
  state.active = false;
  state.current_phase = "cancelled";
  state.completed_at = nowIso;
  state.last_turn_at = nowIso;
  state.interrupted_at = nowIso;
  state.stop_reason = `missing_completion_audit:${audit.reason}`;
  state.completion_audit_gate = "blocked";
  state.completion_audit_missing_reason = audit.reason;
  state.completion_audit_blocked_at = nowIso;
  return true;
}

export async function cleanupPostLaunchModeStateFiles(
  cwd: string,
  sessionId: string,
  dependencies: PostLaunchModeCleanupDependencies = {},
): Promise<void> {
  const readdir =
    dependencies.readdir ?? (await import("fs/promises")).readdir;
  const writeFile =
    dependencies.writeFile ?? (await import("fs/promises")).writeFile;
  const writeWarn = dependencies.writeWarn ?? console.warn;
  const now = dependencies.now ?? (() => new Date());
  const scopedDirs = sessionId
    ? [getStateDir(cwd, sessionId)]
    : [getBaseStateDir(cwd)];
  const rootStateDir = getBaseStateDir(cwd);
  const rootSkillActiveStateBeforeCleanup = sessionId
    ? await readSkillActiveState(getSkillActiveStatePathsForStateDir(rootStateDir).rootPath)
    : null;
  let preserveSkillActiveForReviewPendingAutopilot = false;

  for (const stateDir of scopedDirs) {
    const files = await readdir(stateDir).catch(() => [] as string[]);
    const autopilotPath = join(stateDir, "autopilot-state.json");
    const autopilotPrecheck = files.includes("autopilot-state.json")
      ? await readPostLaunchModeStateFile(autopilotPath, dependencies)
      : null;
    const preserveReviewPendingAutopilot = autopilotPrecheck?.kind === "ok"
      && isAutopilotReviewPendingPostLaunchState(autopilotPrecheck.state);
    preserveSkillActiveForReviewPendingAutopilot ||= preserveReviewPendingAutopilot;

    for (const file of files) {
      if (!file.endsWith("-state.json") || file === "session.json") continue;
      const path = join(stateDir, file);
      const mode = file.slice(0, -"-state.json".length);
      const result = await readPostLaunchModeStateFile(path, dependencies);
      if (result.kind !== "ok") {
        if (result.kind === "recoverable") {
          try {
            const completedAt = now().toISOString();
            await writeFile(
              path,
              JSON.stringify(
                mode === SKILL_ACTIVE_STATE_MODE
                  ? buildRecoveredPostLaunchSkillActiveState(completedAt)
                  : buildRecoveredPostLaunchModeState(mode, completedAt),
                null,
                2,
              ),
            );
            if (isTrackedWorkflowMode(mode)) {
              await syncCanonicalSkillStateForMode({
                cwd,
                baseStateDir: rootStateDir,
                mode,
                active: false,
                currentPhase: "cancelled",
                sessionId: stateDir === getStateDir(cwd, sessionId) ? sessionId : undefined,
                nowIso: completedAt,
                source: "postLaunchCleanup",
              });
            }
          } catch (err) {
            writeWarn(
              `[nomx] postLaunch: failed to recover mode state ${path}: ${err instanceof Error ? err.message : err}`,
            );
          }
        } else if (result.kind === "malformed") {
          writeWarn(
            `[nomx] postLaunch: skipped malformed mode state ${path}: ${result.message}`,
          );
        }
        continue;
      }
      const skillStateStillVisible = mode === SKILL_ACTIVE_STATE_MODE
        && Array.isArray(result.state.active_skills)
        && result.state.active_skills.length > 0;
      if (result.state.active !== true && !skillStateStillVisible) {
        const completedAt = now().toISOString();
        const normalized = mode === SKILL_ACTIVE_STATE_MODE
          ? { state: result.state, changed: false }
          : normalizeTerminalWorkflowState(result.state, { mode, nowIso: completedAt });
        if (normalized.changed) {
          result.state = normalized.state;
          await writeFile(path, JSON.stringify(result.state, null, 2));
        }
        if (mode === "ralph") {
          const completedAt = now().toISOString();
          if (markRalphCompletionAuditBlockedForPostLaunch(result.state, cwd, completedAt)) {
            await writeFile(path, JSON.stringify(result.state, null, 2));
            await syncCanonicalSkillStateForMode({
              cwd,
              baseStateDir: rootStateDir,
              mode,
              active: false,
              currentPhase: "cancelled",
              sessionId: stateDir === getStateDir(cwd, sessionId) ? sessionId : undefined,
              nowIso: completedAt,
              source: "postLaunchCleanup",
            });
          }
        }
        continue;
      }
      if (
        preserveReviewPendingAutopilot
        && (mode === "autopilot" || mode === SKILL_ACTIVE_STATE_MODE)
      ) {
        continue;
      }

      try {
        const completedAt = now().toISOString();
        if (mode === SKILL_ACTIVE_STATE_MODE) {
          result.state.active = false;
          result.state.phase = "complete";
          result.state.updated_at = completedAt;
          result.state.active_skills = [];
          await writeFile(path, JSON.stringify(result.state, null, 2));
          continue;
        }
        result.state.active = false;
        result.state.current_phase = "cancelled";
        result.state.completed_at = completedAt;
        result.state = normalizeTerminalWorkflowState(result.state, { mode, nowIso: completedAt }).state;
        if (mode === "ralph") {
          result.state.interrupted_at = completedAt;
          result.state.stop_reason = cleanPostLaunchString(result.state.stop_reason) || "session_exit";
        }
        await writeFile(path, JSON.stringify(result.state, null, 2));
        if (isTrackedWorkflowMode(mode)) {
          await syncCanonicalSkillStateForMode({
            cwd,
            baseStateDir: rootStateDir,
            mode,
            active: false,
            currentPhase: "cancelled",
            sessionId: stateDir === getStateDir(cwd, sessionId) ? sessionId : undefined,
            nowIso: completedAt,
            source: "postLaunchCleanup",
          });
        }
      } catch (err) {
        writeWarn(
          `[nomx] postLaunch: failed to update mode state ${path}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  if (sessionId) {
    try {
      if (!preserveSkillActiveForReviewPendingAutopilot) {
        await scrubPostLaunchRootSkillActiveForSession(
          rootStateDir,
          sessionId,
          now().toISOString(),
          writeFile,
          rootSkillActiveStateBeforeCleanup,
        );
      }
    } catch (err) {
      writeWarn(
        `[nomx] postLaunch: failed to reconcile root skill-active state: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

export async function reapPostLaunchOrphanedMcpProcesses(
  dependencies: PostLaunchCleanupDependencies = {},
): Promise<void> {
  const cleanup = dependencies.cleanup ?? cleanupLaunchOrphanedMcpProcesses;
  const writeInfo = dependencies.writeInfo ?? console.log;
  const writeWarn = dependencies.writeWarn ?? console.warn;
  const writeError =
    dependencies.writeError ?? ((line: string) => process.stderr.write(line));

  try {
    const result = await cleanup();
    if (result.terminatedCount > 0) {
      writeInfo(
        `[nomx] postLaunch: reaped ${result.terminatedCount} orphaned NOMX MCP process(es).`,
      );
    }
    if (result.failedPids.length > 0) {
      writeWarn(
        `[nomx] postLaunch: failed to reap ${result.failedPids.length} orphaned NOMX MCP process(es); continuing cleanup.`,
      );
    }
  } catch (err) {
    writeError(`[cli/index] postLaunch MCP cleanup failed: ${err}\n`);
  }
}

/**
 * preLaunch: Prepare environment before Codex starts.
 * 1. Best-effort launch-safe orphan cleanup for detached NOMX MCP processes
 * 2. Establish the canonical session pointer
 * 3. Generate session-scoped launch artifacts and start best-effort helpers
 *
 * Automatic broad stale-session cleanup remains disabled here. Only detached
 * NOMX MCP processes without a live Codex ancestor are reaped so new launches
 * do not accumulate stale processes from prior crashed/closed sessions.
 */
export async function preLaunch(
  cwd: string,
  sessionId: string,
  notifyTempContract?: NotifyTempContract,
  codexHomeOverride?: string,
  enableNotifyFallbackAuthority: boolean = false,
  worktreeDirty: boolean = false,
): Promise<void> {
  // 1. Best-effort launch-safe orphan cleanup
  try {
    const cleanup = await cleanupLaunchOrphanedMcpProcesses();
    if (cleanup.terminatedCount > 0) {
      console.log(
        `[nomx] Reaped ${cleanup.terminatedCount} orphaned NOMX MCP process(es) before launch.`,
      );
    }
    if (cleanup.failedPids.length > 0) {
      console.warn(
        `[nomx] Failed to reap ${cleanup.failedPids.length} orphaned NOMX MCP process(es); continuing launch.`,
      );
    }
  } catch (err) {
    logCliOperationFailure(err);
    // Non-fatal
  }

  // 2. Establish the canonical pointer before any session-scoped launch artifact.
  await writeSessionStart(cwd, sessionId);

  // 3. Generate runtime overlay + write session-scoped model instructions file
  const orchestrationMode = await resolveSessionOrchestrationMode(
    cwd,
    sessionId,
  );
  const overlay = await generateOverlay(cwd, sessionId, { orchestrationMode });
  const launchAppendix = await readLaunchAppendInstructions();
  const dirtyWorktreeGuidance = worktreeDirty
    ? `\n\n## Session start: dirty worktree detected\n\nThis worktree has uncommitted changes that were present when the session launched.\nBefore executing the requested task, resolve the dirty state first:\n1. Review uncommitted changes with \`git status\` and \`git diff\`.\n2. Commit, stash, or discard changes as appropriate.\n3. Then proceed with the original task.`
    : "";
  const sessionInstructions =
    launchAppendix.trim().length > 0
      ? `${overlay}

${launchAppendix}${dirtyWorktreeGuidance}`
      : `${overlay}${dirtyWorktreeGuidance}`;
  await writeSessionModelInstructionsFile(cwd, sessionId, sessionInstructions);

  // 4. Reset session metrics.
  await resetSessionMetrics(cwd, sessionId);

  // 5. Start notify fallback watcher (best effort)
  try {
    await startNotifyFallbackWatcher(cwd, { codexHomeOverride, enableAuthority: enableNotifyFallbackAuthority, sessionId });
  } catch (err) {
    logCliOperationFailure(err);
    // Non-fatal
  }

  // 6. Start derived watcher (best effort, opt-in)
  try {
    await startHookDerivedWatcher(cwd);
  } catch (err) {
    logCliOperationFailure(err);
    // Non-fatal
  }

  // 7. Emit temp notification startup summary + warnings, then send session-start lifecycle notification (best effort)
  try {
    if (notifyTempContract?.active) {
      process.env[NOMX_NOTIFY_TEMP_CONTRACT_ENV] =
        serializeNotifyTempContract(notifyTempContract);
      const { getNotificationConfig } =
        await import("../notifications/config.js");
      const resolved = getNotificationConfig();
      const startup = buildNotifyTempStartupMessages(
        notifyTempContract,
        Boolean(resolved?.enabled),
      );
      for (const info of startup.infoLines) {
        console.log(`[nomx] ${info}`);
      }
      for (const warning of startup.warningLines) {
        console.warn(`[nomx] ${warning}`);
      }
    } else {
      delete process.env[NOMX_NOTIFY_TEMP_CONTRACT_ENV];
    }
    const { notifyLifecycle } = await import("../notifications/index.js");
    await notifyLifecycle("session-start", {
      sessionId,
      projectPath: cwd,
      projectName: basename(cwd),
    });
  } catch (err) {
    logCliOperationFailure(err);
    // Non-fatal: notification failures must never block launch
  }

  // 8. Dispatch native hook event (best effort)
  try {
    await emitNativeHookEvent(cwd, "session-start", {
      session_id: sessionId,
      context: buildNativeHookBaseContext(cwd, sessionId, "started", {
        project_path: cwd,
        project_name: basename(cwd),
        status: "started",
      }),
    });
  } catch (err) {
    logCliOperationFailure(err);
    // Non-fatal
  }
}

/** Launch Codex CLI directly and block until exit. */
function runCodex(
  cwd: string,
  args: string[],
  sessionId: string,
  _workerDefaultModel?: string,
  codexHomeOverride?: string,
  sqliteHomeOverride?: string,
  notifyTempContractRaw?: string | null,
  _explicitLaunchPolicy?: "direct",
  _projectLocalCodexHomeForCleanup?: string,
  _runtimeCodexHomeForCleanup?: string,
  runtimeContext?: MadmaxWorktreeRuntimeContext,
): { postLaunchHandledExternally: boolean } {
  const launchArgs = injectModelInstructionsBypassArgs(
    cwd,
    args,
    process.env,
    sessionModelInstructionsPath(cwd, sessionId),
  );
  const nomxBin = resolveOmxCliEntryPath({ argv1: process.argv[1], cwd, env: process.env });
  if (!nomxBin) throw new Error("Unable to resolve NOMX launcher path");

  const runtimeEnvOverlay = buildMadmaxWorktreeRuntimeEnvOverlay(runtimeContext);
  const nomxRootOverride = runtimeContext?.nomxRoot ?? resolveOmxRootForLaunch(cwd, process.env);
  const codexBaseEnv = prependOmxRuntimeCommandShimToEnv(
    cwd,
    {
      ...stripHermesMcpBridgeEnv(process.env),
      ...(codexHomeOverride ? { CODEX_HOME: codexHomeOverride } : {}),
      ...(sqliteHomeOverride ? { [CODEX_SQLITE_HOME_ENV]: sqliteHomeOverride } : {}),
      ...(nomxRootOverride ? { NOMX_ROOT: nomxRootOverride } : {}),
      ...runtimeEnvOverlay,
    },
    nomxBin,
  );
  const codexEnvWithSession = {
    ...codexBaseEnv,
    NOMX_CODEX_LAUNCH_ID: randomUUID(),
    NOMX_SESSION_ID: sessionId,
  };
  const codexEnvWithNotify = notifyTempContractRaw
    ? { ...codexEnvWithSession, [NOMX_NOTIFY_TEMP_CONTRACT_ENV]: notifyTempContractRaw }
    : codexEnvWithSession;

  runCodexBlocking(cwd, launchArgs, codexEnvWithNotify);
  return { postLaunchHandledExternally: false };
}

function encodePowerShellCommand(commandText: string): string {
  return Buffer.from(commandText, "utf16le").toString("base64");
}


export function buildWindowsPromptCommand(
  command: string,
  args: string[],
): string {
  const invocation = [
    "&",
    quotePowerShellArg(command),
    ...args.map(quotePowerShellArg),
  ].join(" ");
  const wrappedCommand = [
    "$ErrorActionPreference = 'Stop'",
    `& { ${invocation} }`,
  ].join("; ");
  return `powershell.exe -NoLogo -NoExit -EncodedCommand ${encodePowerShellCommand(wrappedCommand)}`;
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function quotePowerShellArg(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}


/**
 * postLaunch: Clean up after Codex exits.
 * Each step is independently fault-tolerant (try/catch per step).
 */
export async function postLaunch(
  cwd: string,
  sessionId: string,
  codexHomeOverride?: string,
  enableNotifyFallbackAuthority: boolean = false,
  projectLocalCodexHomeForCleanup?: string,
): Promise<void> {
  // Capture session start time before cleanup (writeSessionEnd deletes session.json)
  let sessionStartedAt: string | undefined;
  try {
    const sessionState = await readSessionState(cwd);
    sessionStartedAt = sessionState?.started_at;
  } catch (err) {
    logCliOperationFailure(err);
    // Non-fatal
  }

  // 0. Reap MCP orphans left behind by the session that just exited.
  await reapPostLaunchOrphanedMcpProcesses();

  // 0. Flush fallback watcher once to reduce race with fast codex exit.
  try {
    await flushNotifyFallbackOnce(cwd, { codexHomeOverride, enableAuthority: enableNotifyFallbackAuthority, sessionId });
  } catch (err) {
    logCliOperationFailure(err);
    // Non-fatal
  }

  // 0. Stop notify fallback watcher first.
  try {
    await stopNotifyFallbackWatcher(cwd);
  } catch (err) {
    logCliOperationFailure(err);
    // Non-fatal
  }

  // 0. Flush derived watcher once on shutdown (opt-in, best effort).
  try {
    await flushHookDerivedWatcherOnce(cwd);
  } catch (err) {
    logCliOperationFailure(err);
    // Non-fatal
  }

  // 0.1 Stop derived watcher first (opt-in, best effort).
  try {
    await stopHookDerivedWatcher(cwd);
  } catch (err) {
    logCliOperationFailure(err);
    // Non-fatal
  }

  // 0.5. Remove Codex transient TUI NUX counters from project-local config only.
  try {
    if (projectLocalCodexHomeForCleanup) {
      await cleanCodexModelAvailabilityNuxIfNeeded(
        join(projectLocalCodexHomeForCleanup, "config.toml"),
      );
    }
  } catch (err) {
    console.error(
      `[nomx] postLaunch: project config transient NUX cleanup failed: ${err instanceof Error ? err.message : err}`,
    );
  }

  // 1. Remove session-scoped model instructions file
  try {
    await removeSessionModelInstructionsFile(cwd, sessionId);
  } catch (err) {
    console.error(
      `[nomx] postLaunch: model instructions cleanup failed: ${err instanceof Error ? err.message : err}`,
    );
  }

  // 2. Archive session (write history, delete session.json)
  try {
    await writeSessionEnd(cwd, sessionId);
  } catch (err) {
    console.error(
      `[nomx] postLaunch: session archive failed: ${err instanceof Error ? err.message : err}`,
    );
  }

  // 3. Cancel any still-active modes
  try {
    await cleanupPostLaunchModeStateFiles(cwd, sessionId);
  } catch (err) {
    console.error(
      `[nomx] postLaunch: mode cleanup failed: ${err instanceof Error ? err.message : err}`,
    );
  }

  // 4. Send session-end lifecycle notification (best effort)
  try {
    const { notifyLifecycle } = await import("../notifications/index.js");
    const durationMs = sessionStartedAt
      ? Date.now() - new Date(sessionStartedAt).getTime()
      : undefined;
    await notifyLifecycle("session-end", {
      sessionId,
      projectPath: cwd,
      projectName: basename(cwd),
      durationMs,
      reason: "session_exit",
    });
  } catch (err) {
    logCliOperationFailure(err);
    // Non-fatal: notification failures must never block session cleanup
  }

  // 5. Dispatch native hook event (best effort)
  try {
    const durationMs = sessionStartedAt
      ? Date.now() - new Date(sessionStartedAt).getTime()
      : undefined;
    const normalizedEvent =
      process.exitCode && process.exitCode !== 0 ? "failed" : "finished";
    const errorSummary =
      normalizedEvent === "failed"
        ? `codex exited with code ${process.exitCode}`
        : undefined;
    await emitNativeHookEvent(cwd, "session-end", {
      session_id: sessionId,
      context: buildNativeHookBaseContext(cwd, sessionId, normalizedEvent, {
        project_path: cwd,
        project_name: basename(cwd),
        duration_ms: durationMs,
        reason: "session_exit",
        status: normalizedEvent === "failed" ? "failed" : "finished",
        ...(process.exitCode !== undefined
          ? { exit_code: process.exitCode }
          : {}),
        ...(errorSummary ? { error_summary: errorSummary } : {}),
      }),
    });
  } catch (err) {
    logCliOperationFailure(err);
    // Non-fatal
  }
}

export async function runDetachedSessionPostLaunch(
  cwd: string,
  sessionId: string,
  codexHomeOverride?: string,
  projectLocalCodexHomeForCleanup?: string,
  runtimeCodexHomeForCleanup?: string,
): Promise<void> {
  await postLaunch(
    cwd,
    sessionId,
    codexHomeOverride,
    false,
    projectLocalCodexHomeForCleanup,
  );
  await cleanupRuntimeCodexHome(runtimeCodexHomeForCleanup, projectLocalCodexHomeForCleanup).catch(logCliOperationFailure);
}

async function emitNativeHookEvent(
  cwd: string,
  event: "session-start" | "session-end" | "session-idle" | "turn-complete",
  opts: {
    session_id?: string;
    thread_id?: string;
    turn_id?: string;
    mode?: string;
    context?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const payload = buildHookEvent(event, {
    source: "native",
    context: opts.context || {},
    session_id: opts.session_id,
    thread_id: opts.thread_id,
    turn_id: opts.turn_id,
    mode: opts.mode,
  });
  await dispatchHookEvent(payload, {
    cwd,
    enabled: true,
  });
}

function notifyFallbackPidPath(cwd: string): string {
  return join(nomxRoot(cwd), "state", "notify-fallback.pid");
}

function hookDerivedWatcherPidPath(cwd: string): string {
  return join(nomxRoot(cwd), "state", "hook-derived-watcher.pid");
}

export function shouldDetachBackgroundHelper(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  // The long-running watcher/helper itself must stay detached so it can
  // survive parent loss. Windows Git Bash/MSYS uses a short hidden bootstrap
  // process so the detached helper is created without stealing focus.
  void env;
  void platform;
  return true;
}

export type BackgroundHelperLaunchMode =
  | "direct-detached"
  | "windows-msys-bootstrap";

export function resolveBackgroundHelperLaunchMode(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): BackgroundHelperLaunchMode {
  return platform === "win32" && Boolean(env.MSYSTEM || env.MINGW_PREFIX)
    ? "windows-msys-bootstrap"
    : "direct-detached";
}

export function buildWindowsMsysBackgroundHelperBootstrapScript(
  helperArgs: readonly string[],
  cwd: string,
): string {
  const helperArgsLiteral = JSON.stringify(helperArgs);
  const cwdLiteral = JSON.stringify(cwd);
  return [
    "const { spawn } = require('child_process');",
    `const child = spawn(process.execPath, ${helperArgsLiteral}, { cwd: ${cwdLiteral}, detached: true, stdio: 'ignore', windowsHide: true, env: process.env });`,
    "if (!child.pid) process.exit(1);",
    "process.stdout.write(String(child.pid));",
    "child.unref();",
  ].join("");
}

async function launchBackgroundHelper(
  helperArgs: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<number | undefined> {
  const launchMode = resolveBackgroundHelperLaunchMode(
    options.env,
    process.platform,
  );

  if (launchMode === "windows-msys-bootstrap") {
    const { spawnSync } = await import("child_process");
    const bootstrap = spawnSync(
      process.execPath,
      [
        "-e",
        buildWindowsMsysBackgroundHelperBootstrapScript(
          helperArgs,
          options.cwd,
        ),
      ],
      {
        cwd: options.cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: options.env,
      },
    );

    if (bootstrap.error) {
      throw bootstrap.error;
    }

    if (bootstrap.status !== 0) {
      const detail = (bootstrap.stderr || bootstrap.stdout || "").trim();
      throw new Error(
        detail || `background helper bootstrap exited ${bootstrap.status}`,
      );
    }

    const helperPid = Number.parseInt((bootstrap.stdout || "").trim(), 10);
    return Number.isFinite(helperPid) && helperPid > 0
      ? helperPid
      : undefined;
  }

  const child = spawn(process.execPath, helperArgs, {
    cwd: options.cwd,
    detached: shouldDetachBackgroundHelper(options.env, process.platform),
    stdio: "ignore",
    windowsHide: true,
    env: options.env,
  });
  child.unref();
  return child.pid;
}

function parseWatcherPidFile(content: string): number | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "number") {
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    const pid =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { pid?: unknown }).pid
        : undefined;
    return typeof pid === "number" && Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    const pid = Number.parseInt(trimmed, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  }
}

interface WatcherPidRecord {
  pid: number;
  startedAt: string | null;
}

export type NotifyFallbackReapResult =
  | "missing"
  | "invalid"
  | "identity_mismatch"
  | "recent_active"
  | "reaped"
  | "failed";

const DEFAULT_NOTIFY_FALLBACK_REAP_GRACE_MS = 5000;

function resolveNotifyFallbackReapGraceMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env.NOMX_NOTIFY_FALLBACK_REAP_GRACE_MS || "", 10);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return DEFAULT_NOTIFY_FALLBACK_REAP_GRACE_MS;
}

function isWatcherRecordWithinReapGrace(
  record: WatcherPidRecord,
  nowMs = Date.now(),
  graceMs = resolveNotifyFallbackReapGraceMs(),
): boolean {
  if (graceMs <= 0 || !record.startedAt) return false;
  const startedMs = Date.parse(record.startedAt);
  if (!Number.isFinite(startedMs)) return false;
  const ageMs = nowMs - startedMs;
  return ageMs >= 0 && ageMs < graceMs;
}

function parseWatcherPidRecord(content: string): WatcherPidRecord | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      const { pid, started_at: startedAtRaw } = parsed as {
        pid?: unknown;
        started_at?: unknown;
      };
      if (typeof pid === "number" && Number.isFinite(pid) && pid > 0) {
        return {
          pid,
          startedAt: typeof startedAtRaw === "string" ? startedAtRaw : null,
        };
      }
    }
  } catch {
  }

  const pid = parseWatcherPidFile(trimmed);
  return pid ? { pid, startedAt: null } : null;
}

function isLikelyOmxWatcherProcess(
  pid: number,
  execFileSyncFn: typeof execFileSync = execFileSync,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform === "win32") {
    // ps is unavailable on native Windows; fall back to unconditional reap
    // to preserve the pre-identity-check behavior on opted-in Windows hosts.
    return true;
  }
  try {
    const cmd = execFileSyncFn("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf-8",
      timeout: 2000,
      windowsHide: true,
    }) as string;
    return cmd.includes("notify-fallback-watcher") || cmd.includes("hook-derived-watcher");
  } catch {
    return false;
  }
}

export async function reapStaleNotifyFallbackWatcher(
  pidPath: string,
  deps: {
    exists?: (path: string) => boolean;
    readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
    tryKillPid?: (pid: number, signal?: NodeJS.Signals) => boolean;
    hasErrnoCode?: (error: unknown, code: string) => boolean;
    warn?: (message?: unknown, ...optionalParams: unknown[]) => void;
    isWatcherProcess?: (pid: number) => boolean;
    nowMs?: () => number;
    reapGraceMs?: number;
  } = {},
): Promise<NotifyFallbackReapResult> {
  const exists = deps.exists ?? existsSync;
  if (!exists(pidPath)) return "missing";

  const { readFile } = await import("fs/promises");
  const readFileImpl = deps.readFile ?? readFile;
  const tryKillPidImpl = deps.tryKillPid ?? tryKillPid;
  const hasErrnoCodeImpl = deps.hasErrnoCode ?? hasErrnoCode;
  const warn = deps.warn ?? console.warn;
  const isWatcherProcessImpl = deps.isWatcherProcess ?? isLikelyOmxWatcherProcess;

  try {
    const record = parseWatcherPidRecord(await readFileImpl(pidPath, "utf-8"));
    if (!record) return "invalid";
    if (!isWatcherProcessImpl(record.pid)) return "identity_mismatch";
    if (isWatcherRecordWithinReapGrace(
      record,
      deps.nowMs?.() ?? Date.now(),
      deps.reapGraceMs ?? resolveNotifyFallbackReapGraceMs(),
    )) {
      return "recent_active";
    }
    tryKillPidImpl(record.pid, "SIGTERM");
    return "reaped";
  } catch (error: unknown) {
    if (!hasErrnoCodeImpl(error, "ESRCH")) {
      warn(
        "[nomx] warning: failed to stop stale notify fallback watcher",
        {
          path: pidPath,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
    return "failed";
  }
}

function tryKillPid(pid: number, signal: NodeJS.Signals = "SIGTERM"): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    throw error;
  }
}

async function startNotifyFallbackWatcher(
  cwd: string,
  options: { codexHomeOverride?: string; enableAuthority?: boolean; sessionId?: string } = {},
): Promise<void> {
  const { mkdir, writeFile } = await import("fs/promises");
  const pidPath = notifyFallbackPidPath(cwd);
  const reapResult = await reapStaleNotifyFallbackWatcher(pidPath);
  if (reapResult === "recent_active") return;

  if (!shouldEnableNotifyFallbackWatcher(process.env, process.platform)) return;

  const pkgRoot = getPackageRoot();
  const watcherScript = resolveNotifyFallbackWatcherScript(pkgRoot);
  const notifyScript = resolveNotifyHookScript(pkgRoot);
  if (!existsSync(watcherScript) || !existsSync(notifyScript)) return;

  await mkdir(join(nomxRoot(cwd), "state"), { recursive: true }).catch(
    (error: unknown) => {
      console.warn(
        "[nomx] warning: failed to create notify fallback watcher state directory",
        {
          cwd,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    },
  );
  const watcherEnv = buildNotifyFallbackWatcherEnv(process.env, {
    codexHomeOverride: options.codexHomeOverride,
    nomxRootOverride: resolveOmxRootForLaunch(cwd, process.env),
    enableAuthority: options.enableAuthority === true,
    sessionId: options.sessionId,
  });
  let watcherPid: number | undefined;
  try {
    watcherPid = await launchBackgroundHelper(
      [
        watcherScript,
        "--cwd",
        cwd,
        "--notify-script",
        notifyScript,
        "--pid-file",
        pidPath,
        "--parent-pid",
        String(process.pid),
        ...(process.env.NOMX_NOTIFY_FALLBACK_MAX_LIFETIME_MS
          ? [
            "--max-lifetime-ms",
            process.env.NOMX_NOTIFY_FALLBACK_MAX_LIFETIME_MS,
          ]
          : []),
      ],
      {
        cwd,
        env: watcherEnv,
      },
    );
  } catch (error: unknown) {
    console.warn("[nomx] warning: failed to launch notify fallback watcher", {
      cwd,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (!watcherPid) return;

  await writeFile(
    pidPath,
    JSON.stringify(
      { pid: watcherPid, started_at: new Date().toISOString() },
      null,
      2,
    ),
  ).catch((error: unknown) => {
    console.warn(
      "[nomx] warning: failed to write notify fallback watcher pid file",
      {
        path: pidPath,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  });
}

async function startHookDerivedWatcher(cwd: string): Promise<void> {
  if (process.env.NOMX_HOOK_DERIVED_SIGNALS !== "1") return;

  const { mkdir, writeFile, readFile } = await import("fs/promises");
  const pidPath = hookDerivedWatcherPidPath(cwd);
  const pkgRoot = getPackageRoot();
  const watcherScript = resolveHookDerivedWatcherScript(pkgRoot);
  if (!existsSync(watcherScript)) return;

  if (existsSync(pidPath)) {
    try {
      const prev = JSON.parse(await readFile(pidPath, "utf-8")) as {
        pid?: number;
      };
      if (prev && typeof prev.pid === "number") {
        process.kill(prev.pid, "SIGTERM");
      }
    } catch (error: unknown) {
      console.warn("[nomx] warning: failed to stop stale hook-derived watcher", {
        path: pidPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await mkdir(join(nomxRoot(cwd), "state"), { recursive: true }).catch(
    (error: unknown) => {
      console.warn(
        "[nomx] warning: failed to create hook-derived watcher state directory",
        {
          cwd,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    },
  );
  let watcherPid: number | undefined;
  try {
    watcherPid = await launchBackgroundHelper([watcherScript, "--cwd", cwd], {
      cwd,
      env: process.env,
    });
  } catch (error: unknown) {
    console.warn("[nomx] warning: failed to launch hook-derived watcher", {
      cwd,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (!watcherPid) return;

  await writeFile(
    pidPath,
    JSON.stringify(
      { pid: watcherPid, started_at: new Date().toISOString() },
      null,
      2,
    ),
  ).catch((error: unknown) => {
    console.warn(
      "[nomx] warning: failed to write hook-derived watcher pid file",
      {
        path: pidPath,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  });
}

async function stopNotifyFallbackWatcher(cwd: string): Promise<void> {
  const { readFile, unlink } = await import("fs/promises");
  const pidPath = notifyFallbackPidPath(cwd);
  if (!existsSync(pidPath)) return;

  try {
    const pid = parseWatcherPidFile(await readFile(pidPath, "utf-8"));
    if (pid) {
      tryKillPid(pid, "SIGTERM");
    }
  } catch (error: unknown) {
    if (!hasErrnoCode(error, "ESRCH")) {
      console.warn(
        "[nomx] warning: failed to stop notify fallback watcher process",
        {
          path: pidPath,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  await unlink(pidPath).catch((error: unknown) => {
    console.warn(
      "[nomx] warning: failed to remove notify fallback watcher pid file",
      {
        path: pidPath,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  });
}

async function stopHookDerivedWatcher(cwd: string): Promise<void> {
  const { readFile, unlink } = await import("fs/promises");
  const pidPath = hookDerivedWatcherPidPath(cwd);
  if (!existsSync(pidPath)) return;

  try {
    const parsed = JSON.parse(await readFile(pidPath, "utf-8")) as {
      pid?: number;
    };
    if (parsed && typeof parsed.pid === "number") {
      process.kill(parsed.pid, "SIGTERM");
    }
  } catch (error: unknown) {
    console.warn("[nomx] warning: failed to stop hook-derived watcher process", {
      path: pidPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await unlink(pidPath).catch((error: unknown) => {
    console.warn(
      "[nomx] warning: failed to remove hook-derived watcher pid file",
      {
        path: pidPath,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  });
}

async function flushNotifyFallbackOnce(
  cwd: string,
  options: { codexHomeOverride?: string; enableAuthority?: boolean; sessionId?: string } = {},
): Promise<void> {
  if (!shouldEnableNotifyFallbackWatcher(process.env, process.platform)) return;
  const { spawnSync } = await import("child_process");
  const pkgRoot = getPackageRoot();
  const watcherScript = resolveNotifyFallbackWatcherScript(pkgRoot);
  const notifyScript = resolveNotifyHookScript(pkgRoot);
  if (!existsSync(watcherScript) || !existsSync(notifyScript)) return;
  spawnSync(
    process.execPath,
    [watcherScript, "--once", "--cwd", cwd, "--notify-script", notifyScript],
    {
      cwd,
      stdio: "ignore",
      timeout: 45_000,
      windowsHide: true,
      env: buildNotifyFallbackWatcherEnv(process.env, {
        codexHomeOverride: options.codexHomeOverride,
        enableAuthority: options.enableAuthority === true,
        sessionId: options.sessionId,
      }),
    },
  );
}

async function flushHookDerivedWatcherOnce(cwd: string): Promise<void> {
  if (process.env.NOMX_HOOK_DERIVED_SIGNALS !== "1") return;
  const { spawnSync } = await import("child_process");
  const pkgRoot = getPackageRoot();
  const watcherScript = resolveHookDerivedWatcherScript(pkgRoot);
  if (!existsSync(watcherScript)) return;
  spawnSync(process.execPath, [watcherScript, "--once", "--cwd", cwd], {
    cwd,
    stdio: "ignore",
    timeout: 3000,
    windowsHide: true,
    env: {
      ...process.env,
      NOMX_HOOK_DERIVED_SIGNALS: "1",
    },
  });
}

// Canonicalize a path for comparing a registry `source_cwd` against the current
// working directory. `process.cwd()` resolves symlinks (e.g. macOS `/var` ->
// `/private/var`), so registry values must be canonicalized the same way or the
// run-dir fallback never matches. Falls back to `resolve` when the path is
// missing (realpathSync requires an existing target).
function canonicalizePathForRunDirMatch(p: string): string {
  try {
    return realpathSync(resolve(p));
  } catch {
    return resolve(p);
  }
}

async function listHookVisibleRunDirStateRefs(cwd: string): Promise<ModeStateFileRef[]> {
  const runsRoot = resolveMadmaxRunsRoot(process.env);
  const registryPath = join(runsRoot, "registry.jsonl");
  const runDirs = new Set<string>();
  const canonicalCwd = canonicalizePathForRunDirMatch(cwd);
  const canonicalRunsRoot = resolve(runsRoot);

  const addRecord = (raw: unknown): void => {
    if (!raw || typeof raw !== "object") return;
    const record = raw as Record<string, unknown>;
    const sourceCwd = typeof record.source_cwd === "string" ? record.source_cwd.trim() : "";
    const worktreeCwd = typeof record.worktree_cwd === "string" ? record.worktree_cwd.trim() : "";
    const runDir = typeof record.run_dir === "string"
      ? record.run_dir.trim()
      : typeof record.cwd === "string"
        ? record.cwd.trim()
        : "";
    if (!sourceCwd || !runDir) return;

    try {
      if (
        canonicalizePathForRunDirMatch(sourceCwd) !== canonicalCwd &&
        (!worktreeCwd || canonicalizePathForRunDirMatch(worktreeCwd) !== canonicalCwd)
      ) return;
      const resolvedRunDir = resolve(runDir);
      if (
        resolvedRunDir !== canonicalRunsRoot
        && !resolvedRunDir.startsWith(`${canonicalRunsRoot}/`)
      ) {
        return;
      }
      runDirs.add(resolvedRunDir);
    } catch {
      return;
    }
  };

  try {
    const rawRegistry = await readFile(registryPath, "utf-8");
    for (const line of rawRegistry.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        addRecord(JSON.parse(trimmed));
      } catch {
        continue;
      }
    }
  } catch {}

  try {
    const activeDir = join(runsRoot, MADMAX_DETACHED_ACTIVE_DIR);
    const files = await readdir(activeDir).catch(() => [] as string[]);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        addRecord(JSON.parse(await readFile(join(activeDir, file), "utf-8")));
      } catch {
        continue;
      }
    }
  } catch {}

  const refs: ModeStateFileRef[] = [];
  const seenPaths = new Set<string>();
  for (const runDir of runDirs) {
    const stateDir = join(runDir, ".nomx", "state");
    let sessionId: string | undefined;
    try {
      const session = JSON.parse(await readFile(join(stateDir, "session.json"), "utf-8")) as Record<string, unknown>;
      if (typeof session.session_id === "string" && session.session_id.trim()) {
        sessionId = session.session_id.trim();
      }
    } catch {}

    const candidateDirs = sessionId ? [join(stateDir, "sessions", sessionId), stateDir] : [stateDir];
    for (const dir of candidateDirs) {
      const files = await readdir(dir).catch(() => [] as string[]);
      for (const file of files) {
        if (!file.endsWith("-state.json") || file === "session.json") continue;
        const path = join(dir, file);
        if (seenPaths.has(path)) continue;
        seenPaths.add(path);
        refs.push({
          mode: file.slice(0, -"-state.json".length),
          path,
          scope: dir === stateDir ? "root" : "session",
        });
      }
    }
  }

  return refs.sort((a, b) => a.mode.localeCompare(b.mode));
}

async function cancelModes(args: string[] = []): Promise<void> {
  const { writeFile, readFile } = await import("fs/promises");
  const cwd = process.cwd();
  const nowIso = new Date().toISOString();
  const force = args.includes("--force");
  try {
    const writableScope = await resolveWritableStateScope(cwd);
    const loadStates = async (refs: ModeStateFileRef[]) => {
      const loaded = new Map<
      string,
      {
        path: string;
        scope: "root" | "session";
        state: Record<string, unknown>;
      }
    >();

      for (const ref of refs) {
        const content = await readFile(ref.path, "utf-8");
        let parsedState: Record<string, unknown>;
        try {
          parsedState = JSON.parse(content) as Record<string, unknown>;
        } catch (err) {
          logCliOperationFailure(err);
          continue;
        }
        loaded.set(ref.mode, {
          path: ref.path,
          scope: ref.scope,
          state: parsedState,
        });
      }
      return loaded;
    };

    let states = await loadStates(await listModeStateFilesWithScopePreference(cwd));
    const hasActiveWorkflowMode = (entries: typeof states): boolean =>
      [...entries.entries()].some(
        ([mode, entry]) => mode !== SKILL_ACTIVE_STATE_MODE && entry.state.active === true,
      );
    if (!hasActiveWorkflowMode(states)) {
      const runDirStates = await loadStates(await listHookVisibleRunDirStateRefs(cwd));
      if (hasActiveWorkflowMode(runDirStates)) states = runDirStates;
    }

    const currentSessionId = writableScope.sessionId ?? "";
    const changed = new Set<string>();
    const reported = new Set<string>();

    const cancelMode = (
      mode: string,
      phase: string = "cancelled",
      reportIfWasActive: boolean = true,
    ): void => {
      const entry = states.get(mode);
      if (!entry) return;
      const wasActive = entry.state.active === true;
      const needsChange =
        entry.state.active !== false ||
        entry.state.current_phase !== phase ||
        typeof entry.state.completed_at !== "string" ||
        String(entry.state.completed_at).trim() === "";
      if (!needsChange) return;
      entry.state.active = false;
      entry.state.current_phase = phase;
      entry.state.completed_at = nowIso;
      entry.state.last_turn_at = nowIso;
      if (mode === SKILL_ACTIVE_STATE_MODE) {
        entry.state.phase = phase;
        const activeSkills = Array.isArray(entry.state.active_skills)
          ? entry.state.active_skills
          : [];
        entry.state.active_skills = activeSkills.map((skill) => (
          skill && typeof skill === "object"
            ? { ...(skill as Record<string, unknown>), active: false, phase }
            : skill
        ));
      }
      changed.add(mode);
      if (reportIfWasActive && wasActive && mode !== SKILL_ACTIVE_STATE_MODE) reported.add(mode);
    };

    const ralphLinksUltrawork = (state: Record<string, unknown>): boolean =>
      state.linked_ultrawork === true || state.linked_mode === "ultrawork";

    const ralph = states.get("ralph");
    const hadActiveRalph = !!(ralph && ralph.state.active === true);
    if (ralph && ralph.state.active === true) {
      cancelMode("ralph", "cancelled", true);
      if (ralphLinksUltrawork(ralph.state))
        cancelMode("ultrawork", "cancelled", true);
    }

    if (!hadActiveRalph) {
      for (const [mode, entry] of states.entries()) {
        if (entry.state.active === true) cancelMode(mode, "cancelled", true);
      }
    }

    for (const [mode, entry] of states.entries()) {
      if (!changed.has(mode)) continue;
      await writeFile(entry.path, JSON.stringify(entry.state, null, 2));
    }
    if (force && currentSessionId) {
      const stopStateEntries = [...states.entries()].filter(([mode]) => mode === "native-stop");
      for (const [, entry] of stopStateEntries) {
        const sessions = entry.state.sessions && typeof entry.state.sessions === "object" && !Array.isArray(entry.state.sessions)
          ? { ...(entry.state.sessions as Record<string, unknown>) }
          : null;
        if (!sessions || !Object.prototype.hasOwnProperty.call(sessions, currentSessionId)) continue;
        delete sessions[currentSessionId];
        entry.state.sessions = sessions;
        await writeFile(entry.path, JSON.stringify(entry.state, null, 2));
        changed.add("native-stop");
      }
    }

    for (const mode of reported) {
      console.log(`Cancelled: ${mode}`);
    }

    if (reported.size === 0) {
      console.log("No active modes to cancel.");
    }
  } catch (err) {
    logCliOperationFailure(err);
    console.log("No active modes to cancel.");
  }
}
