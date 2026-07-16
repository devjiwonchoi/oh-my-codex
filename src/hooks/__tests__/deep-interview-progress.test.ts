import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  DEEP_INTERVIEW_STATE_FILE,
  recordSkillActivation,
} from '../keyword-detector.js';
import { validateDeepInterviewProgress } from '../deep-interview-progress.js';

test('parses the required visible deep-interview progress table', () => {
  assert.deepEqual(
    validateDeepInterviewProgress([
      '| Round | Target | Ambiguity | Readiness gate |',
      '| --- | --- | --- | --- |',
      '| 3 | Latency budget | 18% | Decision boundaries unresolved |',
    ].join('\n')),
    {
      ok: true,
      missing: [],
      progress: {
        round: 3,
        target: 'Latency budget',
        ambiguity: 0.18,
        readiness_gate: 'Decision boundaries unresolved',
      },
    },
  );
  assert.deepEqual(validateDeepInterviewProgress('What latency budget applies?'), {
    ok: false,
    missing: ['progress table'],
  });
});

test('keeps an ordinary answer in an active deep interview and preserves progress', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'nomx-keyword-ordinary-deep-interview-answer-'));
  const stateDir = join(cwd, '.nomx', 'state');
  const sessionId = 'ordinary-deep-interview-answer';
  const modePath = join(stateDir, 'sessions', sessionId, DEEP_INTERVIEW_STATE_FILE);
  try {
    await recordSkillActivation({
      stateDir,
      sourceCwd: cwd,
      sessionId,
      text: '$deep-interview clarify the rollout',
      nowIso: '2026-07-17T00:00:00.000Z',
    });
    const modeState = JSON.parse(await readFile(modePath, 'utf-8')) as Record<string, unknown>;
    await writeFile(modePath, JSON.stringify({
      ...modeState,
      interview_progress: {
        schema_version: 1,
        round: 2,
        target: 'Latency budget',
        ambiguity: 0.24,
        readiness_gate: 'Decision boundaries unresolved',
        updated_at: '2026-07-17T00:01:00.000Z',
      },
    }, null, 2));

    const result = await recordSkillActivation({
      stateDir,
      sourceCwd: cwd,
      sessionId,
      text: '300 ms for the initial response.',
      nowIso: '2026-07-17T00:02:00.000Z',
    });

    assert.equal(result?.skill, 'deep-interview');
    assert.equal(result?.active, true);
    const continued = JSON.parse(await readFile(modePath, 'utf-8')) as {
      interview_progress?: { round?: number; ambiguity?: number };
    };
    assert.equal(continued.interview_progress?.round, 2);
    assert.equal(continued.interview_progress?.ambiguity, 0.24);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
