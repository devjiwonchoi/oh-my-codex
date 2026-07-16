/**
 * NOMX HUD - CLI entry point
 *
 * Usage:
 *   nomx hud              Show current HUD state
 *   nomx hud --watch      Poll every 1s with terminal clear
 *   nomx hud --json       Output raw state as JSON
 *   nomx hud --preset=X   Use preset: minimal, focused, full
 */

import { readlinkSync, realpathSync } from 'node:fs';
import { readAllState, readHudConfig } from './state.js';
import { getHudRenderMaxLines, renderHud } from './render.js';
import type { HudFlags, HudPreset, HudRenderContext, ResolvedHudConfig } from './types.js';
import { sleep } from '../utils/sleep.js';
import { runHudAuthorityTick } from './authority.js';

export const HUD_USAGE = [
  'Usage:',
  '  nomx hud              Show current HUD state',
  '  nomx hud --watch      Poll every 1s with terminal clear',
  '  nomx hud --json       Output raw state as JSON',
  '  nomx hud --preset=X   Use preset: minimal, focused, full',
].join('\n');

type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>;

export async function watchRenderLoop(
  render: () => Promise<void>,
  options: {
    intervalMs?: number;
    signal?: AbortSignal;
    onError?: (error: unknown) => void;
    sleepFn?: SleepFn;
  } = {},
): Promise<void> {
  const intervalMs = Math.max(0, options.intervalMs ?? 1000);
  const sleepFn = options.sleepFn ?? sleep;
  const signal = options.signal;

  while (!signal?.aborted) {
    const startedAt = Date.now();
    try {
      await render();
    } catch (error) {
      options.onError?.(error);
    }

    if (signal?.aborted) return;
    const elapsedMs = Date.now() - startedAt;
    await sleepFn(Math.max(0, intervalMs - elapsedMs), signal).catch(() => {});
  }
}

interface RunWatchModeDependencies {
  isTTY: boolean;
  env: NodeJS.ProcessEnv;
  resolveWatchCwdFn: (launchCwd: string) => string;
  readAllStateFn: (cwd: string, config?: ResolvedHudConfig) => Promise<HudRenderContext>;
  readHudConfigFn: (cwd: string) => Promise<ResolvedHudConfig>;
  renderHudFn: (ctx: HudRenderContext, preset: HudPreset, options?: { maxWidth?: number; maxLines?: number }) => string;
  runAuthorityTickFn: (options: { cwd: string }) => Promise<void>;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
  registerSigint: (handler: () => void) => void | (() => void);
  setIntervalFn: (handler: () => void, intervalMs: number) => ReturnType<typeof setInterval>;
  clearIntervalFn: (timer: ReturnType<typeof setInterval>) => void;
}

export interface ResolveHudWatchCwdDependencies {
  getCwd?: () => string;
  realpath?: (path: string) => string;
  readProcCwd?: () => string | null | undefined;
}

function safeCallString(fn: () => string | null | undefined): string | null {
  try {
    const value = fn();
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function defaultProcCwd(): string | null {
  if (process.platform === 'win32') return null;
  return safeCallString(() => readlinkSync('/proc/self/cwd'));
}

function isDeletedCwdMarkerText(path: string | null): boolean {
  return Boolean(path && /(?:^|\s)\(deleted\)\s*$/.test(path.trim()));
}

/**
 * Resolve the cwd a long-running HUD watch should read on this frame.
 *
 * A long-running HUD can retain both a real cwd and a shell PWD string. If that
 * directory is later renamed and the original pathname is reused by a fresh
 * NOMX run, the old HUD process can keep reading the reused launch path and
 * display the new run's state. Compare the launch path to the process' live
 * cwd inode/path each tick; when they diverge, follow the live cwd instead of
 * the stale launch path.
 */
export function resolveHudWatchCwd(
  launchCwd: string,
  deps: ResolveHudWatchCwdDependencies = {},
): string {
  const getCwd = deps.getCwd ?? (() => process.cwd());
  const realpath = deps.realpath ?? ((path: string) => realpathSync.native(path));
  const readProcCwd = deps.readProcCwd ?? defaultProcCwd;

  const processCwd = safeCallString(getCwd);
  const launchPath = launchCwd.trim() || processCwd || launchCwd;
  const livePath = safeCallString(readProcCwd) || processCwd;
  if (!livePath) return launchPath;
  const liveMarkerMayBeProcDeleted = isDeletedCwdMarkerText(livePath) && !isDeletedCwdMarkerText(launchPath) && processCwd !== livePath;
  if (liveMarkerMayBeProcDeleted) {
    const processReal = processCwd ? safeCallString(() => realpath(processCwd)) : null;
    const markerReal = safeCallString(() => realpath(livePath));
    if (!processReal || !markerReal || processReal !== markerReal) return launchPath;
  }

  const launchReal = safeCallString(() => realpath(launchPath));
  const liveReal = safeCallString(() => realpath(livePath));
  if (launchReal && liveReal && launchReal !== liveReal) return livePath;
  if (!launchReal && liveReal) return livePath;
  if (launchReal && !liveReal && livePath !== launchPath) return livePath;
  return launchPath;
}

/**
 * Backward-compatible watch mode runner used by tests.
 */
export async function runWatchMode(
  cwd: string,
  flags: HudFlags,
  deps: Partial<RunWatchModeDependencies> = {},
): Promise<void> {
  if (!flags.watch) return;

  const dependencies: RunWatchModeDependencies = {
    isTTY: deps.isTTY ?? Boolean(process.stdout.isTTY),
    env: deps.env ?? process.env,
    resolveWatchCwdFn: deps.resolveWatchCwdFn ?? ((launchCwd) => resolveHudWatchCwd(launchCwd)),
    readAllStateFn: deps.readAllStateFn ?? readAllState,
    readHudConfigFn: deps.readHudConfigFn ?? readHudConfig,
    renderHudFn: deps.renderHudFn ?? renderHud,
    runAuthorityTickFn: deps.runAuthorityTickFn ?? (async ({ cwd: authorityCwd }) => {
      await runHudAuthorityTick({ cwd: authorityCwd });
    }),
    writeStdout: deps.writeStdout ?? ((text: string) => process.stdout.write(text)),
    writeStderr: deps.writeStderr ?? ((text: string) => process.stderr.write(text)),
    registerSigint: deps.registerSigint ?? ((handler: () => void) => {
      process.on('SIGINT', handler);
      return () => process.off('SIGINT', handler);
    }),
    setIntervalFn: deps.setIntervalFn ?? ((handler: () => void, intervalMs: number) => setInterval(handler, intervalMs)),
    clearIntervalFn: deps.clearIntervalFn ?? ((timer: ReturnType<typeof setInterval>) => clearInterval(timer)),
  };

  if (!dependencies.isTTY && !dependencies.env.CI) {
    dependencies.writeStderr('HUD watch mode requires a TTY\n');
    process.exitCode = 1;
    return;
  }

  dependencies.writeStdout('\x1b[?25l');

  let firstRender = true;
  let inFlight = false;
  let queued = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  let unregisterSigint: void | (() => void);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) dependencies.clearIntervalFn(timer);
    unregisterSigint?.();
    unregisterSigint = undefined;
    dependencies.writeStdout('\x1b[?25h\x1b[2J\x1b[H');
    resolveDone();
  };

  const renderTick = async () => {
    if (stopped) return;
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    try {
      if (firstRender) {
        dependencies.writeStdout('\x1b[2J\x1b[H');
        firstRender = false;
      } else {
        dependencies.writeStdout('\x1b[H');
      }
      const frameCwd = dependencies.resolveWatchCwdFn(cwd);
      const config = await dependencies.readHudConfigFn(frameCwd);
      const ctx = await dependencies.readAllStateFn(frameCwd, config);
      const preset = flags.preset ?? config.preset;
      const maxLines = getHudRenderMaxLines(ctx);
      const line = dependencies.renderHudFn(ctx, preset, {
        maxWidth: process.stdout.columns ?? undefined,
        maxLines,
      });
      dependencies.writeStdout(line + '\x1b[K\x1b[J');
      try {
        await dependencies.runAuthorityTickFn({ cwd: frameCwd });
      } catch (authorityError) {
        const message = authorityError instanceof Error ? authorityError.message : String(authorityError);
        dependencies.writeStderr(`HUD watch authority tick failed: ${message}\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dependencies.writeStderr(`HUD watch render failed: ${message}\n`);
      process.exitCode = 1;
      stop();
      return;
    } finally {
      inFlight = false;
    }

    if (queued) {
      queued = false;
      await renderTick();
    }
  };

  unregisterSigint = dependencies.registerSigint(stop);
  timer = dependencies.setIntervalFn(() => {
    void renderTick();
  }, 1000);

  await renderTick();
  if (!stopped) {
    await done;
  }
}

function parseHudPreset(value: string | undefined): HudPreset | undefined {
  if (value === 'minimal' || value === 'focused' || value === 'full') {
    return value;
  }
  return undefined;
}

function parseFlags(args: string[]): HudFlags {
  const flags: HudFlags = { watch: false, json: false };

  for (const arg of args) {
    if (arg === '--watch' || arg === '-w') {
      flags.watch = true;
    } else if (arg === '--json') {
      flags.json = true;
    } else if (arg.startsWith('--preset=')) {
      const preset = parseHudPreset(arg.slice('--preset='.length));
      if (preset) {
        flags.preset = preset;
      }
    }
  }

  return flags;
}

async function renderOnce(cwd: string, flags: HudFlags): Promise<void> {
  const config = await readHudConfig(cwd);
  const ctx = await readAllState(cwd, config);

  const preset = flags.preset ?? config.preset;

  if (flags.json) {
    console.log(JSON.stringify(ctx, null, 2));
    return;
  }

  console.log(renderHud(ctx, preset, {
    maxWidth: process.stdout.columns ?? undefined,
    maxLines: getHudRenderMaxLines(ctx),
  }));
}

export async function hudCommand(
  args: string[],
  deps: { cwd?: string } = {},
): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    console.log(HUD_USAGE);
    return;
  }

  const flags = parseFlags(args);
  const cwd = deps.cwd ?? process.cwd();

  if (!flags.watch) {
    await renderOnce(cwd, flags);
    return;
  }

  await runWatchMode(cwd, flags);
}
