import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { readTeamModeConfig, teamModeEnabled } from '../../config/team-mode.js';
import { recordSkillActivation } from '../keyword-detector.js';

test('retired Team configuration stays disabled even when legacy setup requests enablement', () => {
  assert.equal(teamModeEnabled('enabled'), false);
  assert.equal(readTeamModeConfig().enabled, false);
});

test('retired Team invocations do not create active workflow state', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'nomx-retired-team-routing-'));
  const stateDir = join(cwd, '.nomx', 'state');
  try {
    await mkdir(stateDir, { recursive: true });
    const activation = await recordSkillActivation({
      stateDir,
      sourceCwd: cwd,
      text: '$team implement the approved plan',
      nowIso: '2026-07-16T20:00:00.000Z',
    });

    assert.equal(activation, null);
    assert.equal(existsSync(join(stateDir, 'skill-active-state.json')), false);
    assert.equal(existsSync(join(stateDir, 'team-state.json')), false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('plain continuation ignores compatibility-only active Team state', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'nomx-retired-team-continuation-'));
  const stateDir = join(cwd, '.nomx', 'state');
  const statePath = join(stateDir, 'skill-active-state.json');
  const legacyState = {
    version: 1,
    active: true,
    skill: 'team',
    keyword: '$team',
    phase: 'executing',
    activated_at: '2026-07-16T19:00:00.000Z',
    updated_at: '2026-07-16T19:00:00.000Z',
    source: 'keyword-detector',
    active_skills: [{ skill: 'team', active: true }],
  };
  try {
    await mkdir(stateDir, { recursive: true });
    await writeFile(statePath, `${JSON.stringify(legacyState, null, 2)}\n`);

    const activation = await recordSkillActivation({
      stateDir,
      sourceCwd: cwd,
      text: 'continue',
      nowIso: '2026-07-16T20:00:00.000Z',
    });

    assert.equal(activation, null);
    assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), legacyState);
    assert.equal(existsSync(join(stateDir, 'team-state.json')), false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
