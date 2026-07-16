#!/usr/bin/env node

import { existsSync } from 'fs';
import { appendFile, mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'fs/promises';
import { spawn, type ChildProcess } from 'child_process';
import { dirname, join, resolve } from 'path';
import { homedir } from 'os';
import { StringDecoder } from 'string_decoder';
import { isSessionStale, isSessionStateAuthoritativeForCwd, readSessionState } from '../hooks/session.js';
import { sameFilePath } from '../utils/paths.js';
import { validateSessionId } from '../mcp/state-paths.js';
import { shouldContinueRun } from '../runtime/run-loop.js';
import { deliverNotifyFallback, compactNotifyFallbackDeliveries, NOTIFY_FALLBACK_LEASE_MS } from './notify-fallback-delivery.js';

function argValue(name: string, fallback = ''): string {
  const idx = process.argv.indexOf(name);
  if (idx < 0 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1];
}

function asNumber(value: string | number | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function normalizeValidSessionId(value: unknown): string {
  const trimmed = safeString(value).trim();
  if (!trimmed) return '';
  try {
    return validateSessionId(trimmed) ?? '';
  } catch {
    return '';
  }
}

function parsePositivePid(value: unknown): number | null {
  const pid = Math.trunc(asNumber(value as string | number | undefined, 0));
  return pid > 0 ? pid : null;
}

function parseIsoMillis(value: string | null | undefined): number | null {
  const parsed = Date.parse(safeString(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error !== null && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let atomicJsonWriteCounter = 0;

async function writeJsonObjectAtomically(path: string, value: unknown): Promise<void> {
  const tempPath = `${path}.${process.pid}.${Date.now()}.${++atomicJsonWriteCounter}.tmp`;
  try {
    await writeFile(tempPath, JSON.stringify(value, null, 2));
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function waitForPidExit(pid: number, timeoutMs = 3000, stepMs = 50): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await sleep(stepMs);
  }
  return !isPidAlive(pid);
}

const cwd = resolve(argValue('--cwd', process.cwd()));
const notifyScript = resolve(argValue('--notify-script', join(cwd, 'dist', 'scripts', 'notify-hook.js')));
const runOnce = process.argv.includes('--once');
const fallbackIfPrimaryIdle = process.argv.includes('--fallback-if-primary-idle');
// Keep notification delivery responsive without coupling the watcher to any
// orchestration control plane.
const pollMs = Math.max(50, asNumber(argValue('--poll-ms', '250'), 250));
const idleMaxPollMs = Math.max(
  pollMs,
  asNumber(argValue('--idle-max-poll-ms', process.env.NOMX_NOTIFY_FALLBACK_IDLE_MAX_POLL_MS || '1000'), 1000),
);
const parentPid = Math.trunc(asNumber(argValue('--parent-pid', String(process.ppid || 0)), process.ppid || 0));
const startedAt = Date.now();
const fileWindowMs = runOnce ? 15000 : 30000;
const defaultMaxLifetimeMs = 6 * 60 * 60 * 1000;
const requestedMaxLifetimeMs = asNumber(
  argValue('--max-lifetime-ms', process.env.NOMX_NOTIFY_FALLBACK_MAX_LIFETIME_MS || String(defaultMaxLifetimeMs)),
  defaultMaxLifetimeMs,
);
const configuredMaxLifetimeMs = Number.isSafeInteger(requestedMaxLifetimeMs) && requestedMaxLifetimeMs > 0
  ? requestedMaxLifetimeMs
  : defaultMaxLifetimeMs;
const maxLifetimeMs = runOnce ? 0 : Math.max(pollMs, configuredMaxLifetimeMs);
const deliveryLifetimeMs = runOnce
  ? NOTIFY_FALLBACK_LEASE_MS
  : Math.min(Math.max(pollMs, configuredMaxLifetimeMs), 24 * 60 * 60 * 1000);
const deliveryDeadlineAtMs = startedAt + deliveryLifetimeMs;

const runtimeRoot = resolve(process.env.NOMX_ROOT || process.env.NOMX_STATE_ROOT || cwd);
const nomxDir = join(runtimeRoot, '.nomx');
const logsDir = join(nomxDir, 'logs');
const stateDir = join(nomxDir, 'state');
const statePath = join(stateDir, 'notify-fallback-state.json');
const pidFilePath = resolve(argValue('--pid-file', join(stateDir, 'notify-fallback.pid')));
const logPath = join(logsDir, `notify-fallback-${new Date().toISOString().split('T')[0]}.jsonl`);
const logRotatePath = `${logPath}.1`;
const logLockPath = `${logPath}.lock`;
const defaultMaxLogBytes = 10 * 1024 * 1024;
const maxLogBytes = Math.max(
  0,
  asNumber(argValue('--log-max-bytes', process.env.NOMX_NOTIFY_FALLBACK_LOG_MAX_BYTES || String(defaultMaxLogBytes)), defaultMaxLogBytes),
);
const watcherOwnerToken = `${process.pid}-${startedAt}-${Math.random().toString(36).slice(2, 10)}`;
const RALPH_TERMINAL_PHASES = new Set(['blocked_on_user', 'complete', 'failed', 'cancelled']);
const RALPH_STARTING_PHASE_TIMEOUT_MS = 2 * 60_000;
const QUIET_ONCE_EVENT_TYPES = new Set(['watcher_start', 'watcher_once_complete']);

interface WatcherFileMeta {
  threadId: string;
  offset: number;
  size: number;
  partial: string;
  decoder: StringDecoder;
}

interface PidFileRecord {
  pid: number;
  parent_pid?: number;
  cwd?: string;
  started_at?: string;
  max_lifetime_ms?: number;
  owner_token?: string;
}

interface ParentGuardState {
  reason: string;
  state_path: string;
  current_phase: string;
}

interface PrimaryWatcherHealthState {
  healthy: boolean;
  reason: string;
  primary_pid: number | null;
  heartbeat_at: string;
  freshness_ms: number | null;
  threshold_ms: number | null;
}

interface AdaptivePollState {
  enabled: boolean;
  base_ms: number;
  max_ms: number;
  current_ms: number;
  idle_streak: number;
  last_tick_at: string | null;
  last_activity_at: string | null;
  last_activity_reason: string;
}

interface CycleActivitySummary {
  active: boolean;
  reason: string;
}

const fileState = new Map<string, WatcherFileMeta>();
const seenTurnKeys = new Set<string>();
let stopping = false;
let shutdownPromise: Promise<void> | null = null;
let activeNotifyHookChild: ChildProcess | null = null;
let activeNotifyHookClose: Promise<{ status: number | null; signal: string | null }> | null = null;
let activeNotifyHookTermination: Promise<boolean> | null = null;
let activeDeliveryPromise: Promise<unknown> | null = null;
async function terminateActiveNotifyHookChild(): Promise<boolean> {
  if (activeNotifyHookTermination) return activeNotifyHookTermination;
  const child = activeNotifyHookChild;
  const close = activeNotifyHookClose;
  if (!child || !close) return true;
  activeNotifyHookTermination = (async () => {
    child.kill('SIGTERM');
    const termResult = await Promise.race([close.then(() => true), sleep(1_000).then(() => false)]);
    if (termResult) return true;
    child.kill('SIGKILL');
    return Promise.race([close.then(() => true), sleep(2_000).then(() => false)]);
  })();
  try {
    return await activeNotifyHookTermination;
  } finally {
    activeNotifyHookTermination = null;
  }
}
let lastParentGuard: ParentGuardState = {
  reason: '',
  state_path: '',
  current_phase: '',
};
let adaptivePollState: AdaptivePollState = {
  enabled: true,
  base_ms: pollMs,
  max_ms: idleMaxPollMs,
  current_ms: pollMs,
  idle_streak: 0,
  last_tick_at: null,
  last_activity_at: null,
  last_activity_reason: 'init',
};

function shouldSuppressEventLog(event: Record<string, unknown>): boolean {
  const eventType = safeString(event.type).trim();
  return runOnce && QUIET_ONCE_EVENT_TYPES.has(eventType);
}

async function acquireLogLock(timeoutMs = 1000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await mkdir(logLockPath, { recursive: false });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'EEXIST') return false;
      const lockStat = await stat(logLockPath).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs > 5000) {
        await rm(logLockPath, { recursive: true, force: true }).catch(() => {});
        continue;
      }
      await sleep(10);
    }
  }
  return false;
}

async function releaseLogLock(): Promise<void> {
  await rm(logLockPath, { recursive: true, force: true }).catch(() => {});
}

async function rotateLogIfNeeded(nextEntryBytes: number): Promise<void> {
  if (maxLogBytes <= 0) return;
  const currentStat = await stat(logPath).catch(() => null);
  if (!currentStat || currentStat.size + nextEntryBytes <= maxLogBytes) return;
  await unlink(logRotatePath).catch(() => {});
  await rename(logPath, logRotatePath).catch(() => {});
}

async function eventLog(event: Record<string, unknown>): Promise<void> {
  if (shouldSuppressEventLog(event)) return;
  const line = `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`;
  await mkdir(dirname(logPath), { recursive: true }).catch(() => {});
  const locked = await acquireLogLock();
  if (!locked) return;
  try {
    await rotateLogIfNeeded(Buffer.byteLength(line));
    await appendFile(logPath, line);
  } catch {
    // best effort only
  } finally {
    await releaseLogLock();
  }
}

function nextIdlePollMs(currentMs: number): number {
  return Math.min(idleMaxPollMs, Math.max(pollMs, currentMs * 2));
}

function updateAdaptivePollState(summary: CycleActivitySummary): number {
  const nowIso = new Date().toISOString();
  if (summary.active) {
    adaptivePollState = {
      ...adaptivePollState,
      enabled: true,
      base_ms: pollMs,
      max_ms: idleMaxPollMs,
      current_ms: pollMs,
      idle_streak: 0,
      last_tick_at: nowIso,
      last_activity_at: nowIso,
      last_activity_reason: summary.reason,
    };
    return adaptivePollState.current_ms;
  }

  const nextMs = nextIdlePollMs(adaptivePollState.current_ms);
  adaptivePollState = {
    ...adaptivePollState,
    enabled: true,
    base_ms: pollMs,
    max_ms: idleMaxPollMs,
    current_ms: nextMs,
    idle_streak: adaptivePollState.idle_streak + 1,
    last_tick_at: nowIso,
    last_activity_reason: summary.reason,
  };
  return adaptivePollState.current_ms;
}

function hasRalphTerminalState(raw: Record<string, unknown> | null | undefined): boolean {
  if (!raw || typeof raw !== 'object') return true;
  if (raw.active !== true) return true;
  if (!shouldContinueRun(raw)) return true;
  const phase = safeString(raw.current_phase).trim().toLowerCase();
  if (phase && RALPH_TERMINAL_PHASES.has(phase)) return true;
  if (isStaleRalphStartingPhase(raw)) return true;
  if (safeString(raw.completed_at).trim()) return true;
  return false;
}

function isStaleRalphStartingPhase(raw: Record<string, unknown>): boolean {
  const phase = safeString(raw.current_phase).trim().toLowerCase();
  if (phase !== 'starting') return false;
  const reference = parseIsoMillis(safeString(raw.last_turn_at)) ?? parseIsoMillis(safeString(raw.started_at));
  if (reference === null) return false;
  return Date.now() - reference > RALPH_STARTING_PHASE_TIMEOUT_MS;
}

async function loadPersistedWatcherState(): Promise<void> {
  const persisted = await readFile(statePath, 'utf-8')
    .then((content) => JSON.parse(content) as Record<string, unknown>)
    .catch(() => null);
  const persistedAdaptivePoll = persisted?.adaptive_poll as Record<string, unknown> | null | undefined;
  if (persistedAdaptivePoll && typeof persistedAdaptivePoll === 'object') {
    adaptivePollState = {
      enabled: persistedAdaptivePoll.enabled !== false,
      base_ms: pollMs,
      max_ms: idleMaxPollMs,
      current_ms: Math.min(idleMaxPollMs, Math.max(pollMs, asNumber(persistedAdaptivePoll.current_ms as string | number | undefined, pollMs))),
      idle_streak: Math.max(0, Math.trunc(asNumber(persistedAdaptivePoll.idle_streak as string | number | undefined, 0))),
      last_tick_at: safeString(persistedAdaptivePoll.last_tick_at) || null,
      last_activity_at: safeString(persistedAdaptivePoll.last_activity_at) || null,
      last_activity_reason: safeString(persistedAdaptivePoll.last_activity_reason) || 'init',
    };
  }
}

interface ActiveModeResult {
  active: boolean;
  reason: string;
  path: string;
  state: Record<string, unknown> | null;
}

async function resolveActiveModeState(mode: string): Promise<ActiveModeResult> {
  const candidateDirs: string[] = [];
  let currentSessionId = '';
  let currentSessionIsLive = false;
  const session = await readSessionState(cwd);
  if (session?.session_id) {
    if (isSessionStateAuthoritativeForCwd(session, cwd)) {
      currentSessionId = normalizeValidSessionId(session.session_id);
      currentSessionIsLive = currentSessionId !== '' && !isSessionStale(session);
    }
    if (currentSessionId && currentSessionIsLive) {
      candidateDirs.push(join(stateDir, 'sessions', currentSessionId));
    }
  }
  if (!candidateDirs.includes(stateDir)) candidateDirs.push(stateDir);

  for (const dir of candidateDirs) {
    if (mode === 'ralph' && dir === stateDir && currentSessionId) {
      return {
        active: false,
        reason: currentSessionIsLive ? 'blocked_by_current_session' : 'stale_current_session',
        path: '',
        state: null,
      };
    }

    const path = join(dir, `${mode}-state.json`);
    if (!existsSync(path)) continue;
    const parsed = await readFile(path, 'utf-8')
      .then((content) => JSON.parse(content) as Record<string, unknown>)
      .catch(() => null);
    if (!parsed || typeof parsed !== 'object') continue;
    if (mode === 'ralph' && dir !== stateDir && isStaleRalphStartingPhase(parsed)) {
      return {
        active: false,
        reason: 'starting_stale',
        path,
        state: parsed,
      };
    }
    if (hasRalphTerminalState(parsed)) {
      return {
        active: false,
        reason: 'terminal',
        path,
        state: parsed,
      };
    }
    return {
      active: true,
      reason: 'active',
      path,
      state: parsed,
    };
  }

  return {
    active: false,
    reason: 'cleared',
    path: '',
    state: null,
  };
}

async function resolveActiveRalphState(): Promise<ActiveModeResult> {
  return resolveActiveModeState('ralph');
}

async function readPidFileRecord(path: string): Promise<PidFileRecord | null> {
  const raw = await readFile(path, 'utf-8').catch(() => '');
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const pid = parsePositivePid(parsed.pid);
    if (pid === null) return null;
    return {
      pid,
      parent_pid: parsePositivePid(parsed.parent_pid) ?? undefined,
      cwd: safeString(parsed.cwd) || undefined,
      started_at: safeString(parsed.started_at) || undefined,
      max_lifetime_ms: asNumber(parsed.max_lifetime_ms as string | number | undefined, 0) || undefined,
      owner_token: safeString(parsed.owner_token) || undefined,
    };
  } catch {
    const pid = parsePositivePid(trimmed);
    return pid === null ? null : { pid };
  }
}

function createPrimaryWatcherHealthState(
  reason: string,
  overrides: Partial<PrimaryWatcherHealthState> = {},
): PrimaryWatcherHealthState {
  return {
    healthy: false,
    reason,
    primary_pid: null,
    heartbeat_at: '',
    freshness_ms: null,
    threshold_ms: null,
    ...overrides,
  };
}

async function resolvePrimaryWatcherHealth(now = Date.now()): Promise<PrimaryWatcherHealthState> {
  const existingRecord = await readPidFileRecord(pidFilePath).catch(() => null);
  if (!existingRecord) return createPrimaryWatcherHealthState('pid_missing');
  if (existingRecord.cwd && !sameFilePath(existingRecord.cwd, cwd)) return createPrimaryWatcherHealthState('cwd_mismatch');
  if (!isPidAlive(existingRecord.pid)) {
    return createPrimaryWatcherHealthState('pid_stale', {
      primary_pid: existingRecord.pid,
    });
  }

  const persistedState = await readJsonObject(statePath);
  if (!persistedState) {
    return createPrimaryWatcherHealthState('state_missing', {
      primary_pid: existingRecord.pid,
    });
  }

  const persistedPid = Math.trunc(asNumber(persistedState.pid as string | number | undefined, 0));
  if (persistedPid > 0 && persistedPid !== existingRecord.pid) {
    return createPrimaryWatcherHealthState('state_pid_mismatch', {
      primary_pid: existingRecord.pid,
    });
  }

  const heartbeatAt = safeString(persistedState.heartbeat_at).trim();
  if (!heartbeatAt) {
    return createPrimaryWatcherHealthState('heartbeat_missing', {
      primary_pid: existingRecord.pid,
    });
  }

  const heartbeatMs = parseIsoMillis(heartbeatAt);
  const primaryPollMs = Math.max(
    50,
    asNumber(
      persistedState.effective_poll_ms as string | number | undefined,
      asNumber(persistedState.poll_ms as string | number | undefined, 250),
    ),
  );
  const thresholdMs = Math.max(1_000, primaryPollMs * 4);
  if (heartbeatMs === null) {
    return createPrimaryWatcherHealthState('heartbeat_invalid', {
      primary_pid: existingRecord.pid,
      heartbeat_at: heartbeatAt,
      threshold_ms: thresholdMs,
    });
  }

  const freshnessMs = now - heartbeatMs;
  if (freshnessMs > thresholdMs) {
    return {
      healthy: false,
      reason: 'heartbeat_stale',
      primary_pid: existingRecord.pid,
      heartbeat_at: heartbeatAt,
      freshness_ms: freshnessMs,
      threshold_ms: thresholdMs,
    };
  }

  return {
    healthy: true,
    reason: 'primary_watcher_healthy',
    primary_pid: existingRecord.pid,
    heartbeat_at: heartbeatAt,
    freshness_ms: freshnessMs,
    threshold_ms: thresholdMs,
  };
}

async function writePidFileRecord(): Promise<void> {
  const nextRecord: PidFileRecord = {
    pid: process.pid,
    parent_pid: parentPid,
    cwd,
    started_at: new Date(startedAt).toISOString(),
    max_lifetime_ms: maxLifetimeMs,
    owner_token: watcherOwnerToken,
  };
  await writeFile(pidFilePath, JSON.stringify(nextRecord, null, 2)).catch(() => {});
}

async function registerPidFile(): Promise<void> {
  if (runOnce) return;
  await mkdir(dirname(pidFilePath), { recursive: true }).catch(() => {});

  const existingRecord = await readPidFileRecord(pidFilePath).catch(() => null);
  const existingPid = existingRecord?.pid ?? null;
  if (existingPid && existingPid !== process.pid && isPidAlive(existingPid)) {
    try {
      process.kill(existingPid, 'SIGTERM');
      const exitedGracefully = await waitForPidExit(existingPid);
      let forced = false;
      if (!exitedGracefully && isPidAlive(existingPid)) {
        forced = true;
        process.kill(existingPid, 'SIGKILL');
        await waitForPidExit(existingPid, 1000, 25);
      }
      await eventLog({
        type: 'watcher_stale_pid_reaped',
        stale_pid: existingPid,
        pid_file: pidFilePath,
        forced,
      });
    } catch (error) {
      await eventLog({
        type: 'watcher_stale_pid_reap_failed',
        stale_pid: existingPid,
        pid_file: pidFilePath,
        error: error instanceof Error ? error.message : safeString(error),
      });
    }
  }

  await writePidFileRecord();
}

async function removePidFileIfOwned(): Promise<void> {
  if (runOnce) return;
  const existingRecord = await readPidFileRecord(pidFilePath).catch(() => null);
  if (existingRecord?.pid !== process.pid) return;
  if (existingRecord.owner_token && existingRecord.owner_token !== watcherOwnerToken) return;
  await unlink(pidFilePath).catch(() => {});
}

function parentIsGone(): boolean {
  if (!Number.isFinite(parentPid) || parentPid <= 0) return false;
  if (parentPid === process.pid) return false;
  return !isPidAlive(parentPid);
}

async function writeState(extra: Record<string, unknown> = {}): Promise<void> {
  await mkdir(stateDir, { recursive: true }).catch(() => {});
  const state = {
    pid: process.pid,
    parent_pid: parentPid,
    started_at: new Date(startedAt).toISOString(),
    heartbeat_at: new Date().toISOString(),
    cwd,
    notify_script: notifyScript,
    delivery_mode: runOnce ? 'once' : 'persistent',
    poll_ms: pollMs,
    effective_poll_ms: adaptivePollState.current_ms,
    idle_max_poll_ms: idleMaxPollMs,
    pid_file: runOnce ? null : pidFilePath,
    max_lifetime_ms: maxLifetimeMs,
    tracked_files: fileState.size,
    seen_turns: seenTurnKeys.size,
    dispatch_drain: {
      enabled: false,
      reason: 'retired_control_plane',
    },
    leader_nudge: {
      enabled: false,
      reason: 'retired_control_plane',
    },
    ralph_continue_steer: {
      enabled: false,
      reason: 'retired_control_plane',
    },
    fallback_auto_nudge: {
      enabled: false,
      reason: 'retired_control_plane',
    },
    adaptive_poll: {
      ...adaptivePollState,
      enabled: true,
      base_ms: pollMs,
      max_ms: idleMaxPollMs,
    },
    ...extra,
  };
  await writeJsonObjectAtomically(statePath, state).catch(() => {});
}

async function readJsonObject(path: string): Promise<Record<string, unknown> | null> {
  return readFile(path, 'utf-8')
    .then((content) => JSON.parse(content) as Record<string, unknown>)
    .catch(() => null);
}

async function requestShutdown(reason: string, signal: string | null = null): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  stopping = true;
  shutdownPromise = (async () => {
    await terminateActiveNotifyHookChild();
    await activeDeliveryPromise?.catch(() => undefined);
    await writeState({ stop_reason: reason, stop_signal: signal, stopping: true });
    await eventLog({
      type: 'watcher_stop',
      signal,
      reason,
      parent_pid: parentPid,
      pid_file: runOnce ? null : pidFilePath,
    });
    await removePidFileIfOwned();
    process.exit(0);
  })();
  return shutdownPromise;
}

async function enforceLifecycleGuards(): Promise<boolean> {
  if (runOnce) return false;
  if (parentIsGone()) {
    const activeRalph = await resolveActiveRalphState();
    if (activeRalph.active) {
      const currentPhase = safeString(activeRalph.state?.current_phase);
      const nextParentGuard: ParentGuardState = {
        reason: 'parent_gone_deferred_for_active_ralph',
        state_path: activeRalph.path,
        current_phase: currentPhase,
      };
      if (
        lastParentGuard.reason !== nextParentGuard.reason
        || lastParentGuard.state_path !== nextParentGuard.state_path
        || lastParentGuard.current_phase !== nextParentGuard.current_phase
      ) {
        await eventLog({
          type: 'watcher_parent_guard',
          reason: nextParentGuard.reason,
          state_path: nextParentGuard.state_path,
          current_phase: currentPhase || null,
        });
        lastParentGuard = nextParentGuard;
      }
      return false;
    }

    lastParentGuard = { reason: '', state_path: '', current_phase: '' };
    await requestShutdown('parent_gone');
    return true;
  }
  if (maxLifetimeMs > 0 && Date.now() - startedAt >= maxLifetimeMs) {
    await requestShutdown('max_lifetime_exceeded');
    return true;
  }
  return false;
}

function sessionDirs(): string[] {
  const now = new Date();
  const today = join(
    homedir(),
    '.codex',
    'sessions',
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0')
  );
  const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterday = join(
    homedir(),
    '.codex',
    'sessions',
    String(yesterdayDate.getUTCFullYear()),
    String(yesterdayDate.getUTCMonth() + 1).padStart(2, '0'),
    String(yesterdayDate.getUTCDate()).padStart(2, '0')
  );
  return Array.from(new Set([today, yesterday]));
}

async function readFirstLine(path: string): Promise<string> {
  const content = await readFile(path, 'utf-8');
  const idx = content.indexOf('\n');
  return idx >= 0 ? content.slice(0, idx) : content;
}

function shouldTrackSessionMeta(line: string): string | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || parsed.type !== 'session_meta' || !parsed.payload) return null;
  const payload = parsed.payload as Record<string, unknown>;
  if (safeString(payload.cwd) !== cwd) return null;
  const threadId = safeString(payload.id);
  return threadId || null;
}

async function discoverRolloutFiles(): Promise<string[]> {
  const discovered: string[] = [];
  for (const dir of sessionDirs()) {
    if (!existsSync(dir)) continue;
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const name of names) {
      if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue;
      const path = join(dir, name);
      const st = await stat(path).catch(() => null);
      if (!st) continue;
      if (st.mtimeMs < startedAt - fileWindowMs) continue;
      discovered.push(path);
    }
  }
  discovered.sort();
  return discovered;
}

function turnKey(threadId: string, turnId: string): string {
  return `${threadId || 'no-thread'}|${turnId || 'no-turn'}`;
}

async function buildNotifyPayload(threadId: string, turnId: string, lastMessage: string): Promise<Record<string, unknown>> {
  const session = await readSessionState(cwd).catch(() => null);
  const payloadSessionId = normalizeValidSessionId(session?.session_id) || threadId;
  return {
    type: 'agent-turn-complete',
    cwd,
    session_id: payloadSessionId,
    'thread-id': threadId,
    'turn-id': turnId,
    'input-messages': ['[notify-fallback] synthesized from rollout task_complete'],
    'last-assistant-message': lastMessage || '',
    source: 'notify-fallback-watcher',
  };
}

async function invokeNotifyHook(payload: Record<string, unknown>): Promise<{ spawned: boolean; childPid?: number; status?: number | null; signal?: string | null; error?: unknown; timedOut?: boolean; authorityDeadline?: boolean; terminationUnconfirmed?: boolean }> {
  return new Promise((resolveInvoke) => {
    let settled = false;
    let spawned = false;
    let timedOut = false;
    let deadlineTimedOut = false;
    const child = spawn(process.execPath, [notifyScript, JSON.stringify(payload)], {
      cwd,
      stdio: 'ignore',
      env: { ...process.env, NOMX_NOTIFY_HOOK_TRUSTED_MANAGED_CWD: cwd },
      windowsHide: true,
    });
    const close = new Promise<{ status: number | null; signal: string | null }>((resolveClose) => {
      child.once('close', (status, signal) => resolveClose({ status, signal }));
    });
    activeNotifyHookChild = child;
    activeNotifyHookClose = close;
    const finish = (result: { spawned: boolean; childPid?: number; status?: number | null; signal?: string | null; error?: unknown; timedOut?: boolean; authorityDeadline?: boolean; terminationUnconfirmed?: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(hookTimeout);
      clearTimeout(deadlineTimeout);
      if (activeNotifyHookChild === child) {
        activeNotifyHookChild = null;
        activeNotifyHookClose = null;
        activeNotifyHookTermination = null;
      }
      resolveInvoke(result);
    };
    const stopForTimeout = async (isDeadline: boolean) => {
      if (settled) return;
      if (isDeadline) deadlineTimedOut = true;
      else timedOut = true;
      const confirmed = await terminateActiveNotifyHookChild();
      const closed = await Promise.race([close, sleep(2_000).then(() => null)]);
      finish({ spawned: true, childPid: child.pid, status: closed?.status ?? null, signal: closed?.signal ?? null, timedOut, authorityDeadline: deadlineTimedOut, terminationUnconfirmed: !confirmed || closed === null, error: isDeadline ? new Error('authority_deadline') : new Error('hook_timeout') });
    };
    const hookTimeout = setTimeout(() => { void stopForTimeout(false); }, 10_000);
    const deadlineTimeout = setTimeout(() => { void stopForTimeout(true); }, Math.max(0, deliveryDeadlineAtMs - Date.now()));
    child.once('error', (error) => finish({ spawned, childPid: child.pid, error }));
    child.once('spawn', () => { spawned = true; });
    void close.then(({ status, signal }) => finish({ spawned, childPid: child.pid, status, signal }));
  });
}

async function processLine(meta: WatcherFileMeta, line: string, filePath: string): Promise<void> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }

  if (!parsed || parsed.type !== 'event_msg' || !parsed.payload) return;
  if ((parsed.payload as Record<string, unknown>).type !== 'task_complete') return;
  const turnId = safeString((parsed.payload as Record<string, unknown>).turn_id);
  const evtTs = Date.parse(safeString(parsed.timestamp));
  const key = turnKey(meta.threadId, turnId);
  if (!turnId || !Number.isFinite(evtTs) || evtTs > Date.now() + 5 * 60 * 1000 || evtTs < startedAt - 3000) {
    seenTurnKeys.add(key);
    return;
  }
  if (seenTurnKeys.has(key)) return;
  const payload = await buildNotifyPayload(
    meta.threadId,
    turnId,
    safeString((parsed.payload as Record<string, unknown>).last_agent_message),
  );
  let spawnResult: Awaited<ReturnType<typeof invokeNotifyHook>> | undefined;
  const deliveryPromise = deliverNotifyFallback({
    stateDir,
    threadId: meta.threadId,
    turnId,
    eventTimestampMs: evtTs,
    rolloutPath: filePath,
    watcherMode: runOnce ? 'once' : 'persistent',
    deadlineAtMs: deliveryDeadlineAtMs,
    stopping: () => stopping,
    spawnHook: async () => {
      spawnResult = await invokeNotifyHook(payload);
      return spawnResult;
    },
  });
  activeDeliveryPromise = deliveryPromise;
  const result = await deliveryPromise.finally(() => {
    if (activeDeliveryPromise === deliveryPromise) activeDeliveryPromise = null;
  });
  if (result.kind === 'retry_eligible' && !stopping && Date.now() + 250 < deliveryDeadlineAtMs) {
    await sleep(250);
    await processLine(meta, line, filePath);
    return;
  }
  seenTurnKeys.add(key);
  if (result.kind !== 'acquired_effect') {
    await eventLog({ type: 'fallback_notify_claim', thread_id: meta.threadId, turn_id: turnId, file: filePath, reason: 'reason' in result ? result.reason : result.kind, attempt: 'attempt' in result ? result.attempt : undefined });
  }
  if (spawnResult?.spawned) {
    await eventLog({
      type: 'fallback_notify',
      ok: spawnResult.status === 0,
      thread_id: meta.threadId,
      turn_id: turnId,
      file: filePath,
      reason: spawnResult.status === 0 ? 'sent' : 'notify_hook_failed',
      error: spawnResult.status === 0 ? undefined : String(spawnResult.error || '').slice(0, 240),
    });
  }
}

async function ensureTrackedFiles(): Promise<void> {
  const files = await discoverRolloutFiles();
  for (const path of files) {
    if (fileState.has(path)) continue;
    const line = await readFirstLine(path).catch(() => '');
    const threadId = shouldTrackSessionMeta(line);
    if (!threadId) continue;
    const fileStat = await stat(path).catch(() => null);
    if (!fileStat) continue;
    const size = fileStat.size || 0;
    const offset = runOnce ? 0 : size;
    fileState.set(path, { threadId, offset, size, partial: '', decoder: new StringDecoder('utf8') });
  }
}

function splitBufferedLines(partial: string, delta: string): { lines: string[]; partial: string } {
  const merged = partial + delta;
  const lines = merged.split('\n');
  return {
    lines,
    partial: lines.pop() || '',
  };
}

async function readFileDelta(
  path: string,
  offset: number,
  currentSize: number,
): Promise<{ bytes: Buffer; nextOffset: number }> {
  const length = currentSize - offset;
  if (length <= 0) return { bytes: Buffer.alloc(0), nextOffset: offset };
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(length);
    let totalBytesRead = 0;
    while (totalBytesRead < length) {
      const { bytesRead } = await handle.read(
        buffer,
        totalBytesRead,
        length - totalBytesRead,
        offset + totalBytesRead,
      );
      if (bytesRead === 0) break;
      totalBytesRead += bytesRead;
    }
    return {
      bytes: buffer.subarray(0, totalBytesRead),
      nextOffset: offset + totalBytesRead,
    };
  } finally {
    await handle.close().catch(() => {});
  }
}

async function pollFiles(): Promise<number> {
  let processedCount = 0;
  for (const [path, meta] of fileState.entries()) {
    const fileStat = await stat(path).catch(() => null);
    if (!fileStat) continue;
    const currentSize = fileStat.size || 0;
    if (currentSize < meta.offset) {
      meta.offset = 0;
      meta.partial = '';
      meta.decoder = new StringDecoder('utf8');
    }
    if (currentSize <= meta.offset) continue;
    const read = await readFileDelta(path, meta.offset, currentSize).catch(() => null);
    if (!read || read.bytes.length === 0) continue;
    const { bytes, nextOffset } = read;
    meta.offset = nextOffset;
    const delta = meta.decoder.write(bytes);
    if (!delta) continue;
    const buffered = splitBufferedLines(meta.partial, delta);
    const lines = buffered.lines;
    meta.partial = buffered.partial;
    for (const line of lines) {
      if (!line.trim()) continue;
      await processLine(meta, line, path);
      processedCount += 1;
    }
  }
  return processedCount;
}

async function runWatcherCycle(): Promise<number> {
  await compactNotifyFallbackDeliveries(stateDir).catch(async (error) => {
    await eventLog({ type: 'fallback_notify_claim', reason: 'compaction_io_skip', error: error instanceof Error ? error.message : String(error) });
  });
  let primaryWatcherHealth: PrimaryWatcherHealthState | null = null;
  if (fallbackIfPrimaryIdle) {
    primaryWatcherHealth = await resolvePrimaryWatcherHealth();
    if (primaryWatcherHealth.healthy) {
      await eventLog({
        type: 'watcher_fallback_skipped',
        ...primaryWatcherHealth,
      });
      return pollMs;
    }
    await eventLog({
      type: 'watcher_fallback_scan',
      ...primaryWatcherHealth,
    });
  }

  await ensureTrackedFiles();
  const processedRolloutCount = await pollFiles();
  const summary: CycleActivitySummary = processedRolloutCount > 0
    ? { active: true, reason: 'rollout_event' }
    : { active: false, reason: 'idle' };
  const nextDelayMs = updateAdaptivePollState(summary);
  if (!fallbackIfPrimaryIdle) {
    await writeState({ last_cycle_activity: summary.reason });
  }
  return nextDelayMs;
}

async function tick(): Promise<void> {
  if (stopping) return;
  if (await enforceLifecycleGuards()) return;
  const nextDelayMs = await runWatcherCycle();
  if (await enforceLifecycleGuards()) return;
  setTimeout(() => {
    void tick();
  }, nextDelayMs);
}

function shutdown(signal: string): void {
  void requestShutdown('signal', signal);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'test' && process.env.NOMX_NOTIFY_FALLBACK_TEST_FATAL === '1') {
    throw new Error('test fatal notify fallback failure');
  }
  await mkdir(logsDir, { recursive: true }).catch(() => {});
  await mkdir(stateDir, { recursive: true }).catch(() => {});
  if (!existsSync(notifyScript)) {
    const reason = `notify script missing: ${notifyScript}`;
    await eventLog({ type: 'watcher_error', reason: 'notify_script_missing', notify_script: notifyScript });
    process.stderr.write(`notify-fallback-watcher: ${reason}\n`);
    process.exit(1);
  }

  await registerPidFile();
  await loadPersistedWatcherState();
  await eventLog({
    type: 'watcher_start',
    cwd,
    notify_script: notifyScript,
    fallback_if_primary_idle: fallbackIfPrimaryIdle,
    poll_ms: pollMs,
    effective_poll_ms: adaptivePollState.current_ms,
    idle_max_poll_ms: idleMaxPollMs,
    once: runOnce,
    parent_pid: parentPid,
    pid_file: runOnce ? null : pidFilePath,
    max_lifetime_ms: maxLifetimeMs,
  });
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));

  if (await enforceLifecycleGuards()) return;

  if (runOnce) {
    await runWatcherCycle();
    await eventLog({
      type: 'watcher_once_complete',
      fallback_if_primary_idle: fallbackIfPrimaryIdle,
      seen_turns: seenTurnKeys.size,
    });
    process.exit(0);
  }

  await tick();
}

main().catch(async (err) => {
  await mkdir(dirname(logPath), { recursive: true }).catch(() => {});
  const message = err instanceof Error ? err.message : safeString(err);
  await eventLog({
    type: 'watcher_error',
    reason: 'fatal',
    error: message,
  });
  process.stderr.write(`notify-fallback-watcher: fatal: ${message || 'unknown error'}\n`);
  process.exit(1);
});
