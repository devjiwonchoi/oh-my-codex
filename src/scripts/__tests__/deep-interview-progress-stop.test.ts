import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { dispatchCodexNativeHook } from '../codex-native-hook.js';

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
}

test('requires and records deep-interview progress when Stop includes the assistant response', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'nomx-stop-deep-interview-progress-'));
  const sessionId = 'stop-deep-interview-progress';
  const stateDir = join(cwd, '.nomx', 'state');
  const sessionDir = join(stateDir, 'sessions', sessionId);
  try {
    await mkdir(sessionDir, { recursive: true });
    await writeJson(join(stateDir, 'session.json'), { session_id: sessionId });
    await writeJson(join(sessionDir, 'skill-active-state.json'), {
      version: 1,
      active: true,
      skill: 'deep-interview',
      phase: 'planning',
      session_id: sessionId,
      thread_id: 'thread-stop-deep-interview-progress',
      active_skills: [{ skill: 'deep-interview', active: true, phase: 'planning', session_id: sessionId }],
    });
    await writeJson(join(sessionDir, 'deep-interview-state.json'), {
      active: true,
      mode: 'deep-interview',
      current_phase: 'intent-first',
      session_id: sessionId,
    });

    const malformed = await dispatchCodexNativeHook({
      hook_event_name: 'Stop',
      cwd,
      session_id: sessionId,
      thread_id: 'thread-stop-deep-interview-progress',
      last_assistant_message: 'What latency budget should the first response meet?',
    }, { cwd });
    assert.equal(malformed.outputJson?.stopReason, 'deep_interview_progress_required');

    const valid = await dispatchCodexNativeHook({
      hook_event_name: 'Stop',
      cwd,
      session_id: sessionId,
      thread_id: 'thread-stop-deep-interview-progress',
      last_assistant_message: [
        '| Round | Target | Ambiguity | Readiness gate |',
        '| --- | --- | --- | --- |',
        '| 3 | Latency budget | 18% | Decision boundaries unresolved |',
        '',
        'Should the 300 ms budget apply to every request or only the initial response?',
      ].join('\n'),
    }, { cwd });
    assert.equal(valid.outputJson, null);
    const state = JSON.parse(await readFile(join(sessionDir, 'deep-interview-state.json'), 'utf-8')) as {
      interview_progress?: { round?: number; target?: string; ambiguity?: number; readiness_gate?: string; updated_at?: string };
    };
    assert.equal(state.interview_progress?.round, 3);
    assert.equal(state.interview_progress?.target, 'Latency budget');
    assert.equal(state.interview_progress?.ambiguity, 0.18);
    assert.equal(state.interview_progress?.readiness_gate, 'Decision boundaries unresolved');
    assert.ok(state.interview_progress?.updated_at);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
