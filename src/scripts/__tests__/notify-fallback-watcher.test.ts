import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

function todaySessionDir(baseHome: string): string {
  const now = new Date();
  return join(
    baseHome,
    '.codex',
    'sessions',
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  );
}

async function writeNotifyScript(path: string, capturePath?: string): Promise<void> {
  await writeFile(
    path,
    capturePath
      ? `import { appendFile } from 'node:fs/promises';\nawait appendFile(${JSON.stringify(capturePath)}, process.argv[2] + '\\n');\n`
      : '',
  );
}

function runWatcher(
  watcherScript: string,
  cwd: string,
  homeDir: string,
  notifyScript: string,
  extraArgs: string[] = [],
) {
  return spawnSync(
    process.execPath,
    [watcherScript, '--once', ...extraArgs, '--cwd', cwd, '--notify-script', notifyScript],
    {
      cwd,
      env: { ...process.env, HOME: homeDir },
      encoding: 'utf8',
    },
  );
}

describe('notify fallback watcher', () => {
  it('publishes a generic heartbeat and marks retired control-plane features disabled', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nomx-notify-fallback-heartbeat-'));
    const homeDir = join(base, 'home');
    const cwd = join(base, 'cwd');
    const notifyScript = join(base, 'notify.mjs');

    try {
      await mkdir(todaySessionDir(homeDir), { recursive: true });
      await mkdir(cwd, { recursive: true });
      await writeNotifyScript(notifyScript);

      const watcherScript = new URL('../notify-fallback-watcher.js', import.meta.url).pathname;
      const result = runWatcher(watcherScript, cwd, homeDir, notifyScript);
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const state = JSON.parse(
        await readFile(join(cwd, '.nomx', 'state', 'notify-fallback-state.json'), 'utf8'),
      ) as Record<string, unknown>;
      assert.equal(Number.isFinite(Date.parse(String(state.heartbeat_at))), true);
      for (const key of ['dispatch_drain', 'leader_nudge', 'ralph_continue_steer', 'fallback_auto_nudge']) {
        assert.deepEqual(state[key], {
          enabled: false,
          reason: 'retired_control_plane',
        });
      }
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('runs a completed-rollout fallback scan when no healthy primary watcher exists', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nomx-notify-fallback-standby-'));
    const homeDir = join(base, 'home');
    const cwd = join(base, 'cwd');
    const notifyScript = join(base, 'notify.mjs');
    const capturePath = join(base, 'notify.jsonl');

    try {
      const sessionDir = todaySessionDir(homeDir);
      await mkdir(sessionDir, { recursive: true });
      await mkdir(cwd, { recursive: true });
      await writeNotifyScript(notifyScript, capturePath);
      await writeFile(
        join(sessionDir, 'rollout-notify-fallback-standby.jsonl'),
        [
          JSON.stringify({
            type: 'session_meta',
            payload: { id: 'thread-notify-fallback-standby', cwd },
          }),
          JSON.stringify({
            timestamp: new Date().toISOString(),
            type: 'event_msg',
            payload: {
              type: 'task_complete',
              turn_id: 'turn-notify-fallback-standby',
              last_agent_message: 'Completed from the fallback scan.',
            },
          }),
          '',
        ].join('\n'),
      );

      const watcherScript = new URL('../notify-fallback-watcher.js', import.meta.url).pathname;
      const result = runWatcher(
        watcherScript,
        cwd,
        homeDir,
        notifyScript,
        ['--fallback-if-primary-idle'],
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(existsSync(capturePath), true, 'fallback scan should invoke the notify hook');

      const payload = JSON.parse((await readFile(capturePath, 'utf8')).trim()) as Record<string, unknown>;
      assert.equal(payload.source, 'notify-fallback-watcher');
      assert.equal(payload['thread-id'], 'thread-notify-fallback-standby');
      assert.equal(payload['turn-id'], 'turn-notify-fallback-standby');
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('backs off a HUD fallback scan while the primary watcher heartbeat is healthy', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nomx-notify-fallback-primary-healthy-'));
    const homeDir = join(base, 'home');
    const cwd = join(base, 'cwd');
    const stateDir = join(cwd, '.nomx', 'state');
    const notifyScript = join(base, 'notify.mjs');
    const capturePath = join(base, 'notify.jsonl');

    try {
      const sessionDir = todaySessionDir(homeDir);
      await mkdir(sessionDir, { recursive: true });
      await mkdir(stateDir, { recursive: true });
      await writeNotifyScript(notifyScript, capturePath);
      await writeFile(
        join(stateDir, 'notify-fallback.pid'),
        JSON.stringify({ pid: process.pid, cwd }),
      );
      await writeFile(
        join(stateDir, 'notify-fallback-state.json'),
        JSON.stringify({
          pid: process.pid,
          cwd,
          heartbeat_at: new Date().toISOString(),
          poll_ms: 250,
          effective_poll_ms: 250,
        }),
      );
      await writeFile(
        join(sessionDir, 'rollout-notify-fallback-primary-healthy.jsonl'),
        [
          JSON.stringify({
            type: 'session_meta',
            payload: { id: 'thread-notify-fallback-primary-healthy', cwd },
          }),
          JSON.stringify({
            timestamp: new Date().toISOString(),
            type: 'event_msg',
            payload: {
              type: 'task_complete',
              turn_id: 'turn-notify-fallback-primary-healthy',
              last_agent_message: 'Primary watcher owns this completion.',
            },
          }),
          '',
        ].join('\n'),
      );

      const watcherScript = new URL('../notify-fallback-watcher.js', import.meta.url).pathname;
      const result = runWatcher(
        watcherScript,
        cwd,
        homeDir,
        notifyScript,
        ['--fallback-if-primary-idle'],
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(existsSync(capturePath), false, 'healthy primary watcher should retain delivery ownership');
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
