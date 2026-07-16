import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cancelAllModes,
  listActiveModes,
  readModeState,
  startMode,
  updateModeState,
} from '../base.js';

describe('modes/base multi-state compatibility', () => {
  it('keeps retired Team state readable but refuses to start a new Team mode', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'nomx-mode-retired-team-read-only-'));
    try {
      const stateDir = join(wd, '.nomx', 'state');
      await mkdir(stateDir, { recursive: true });
      await writeFile(join(stateDir, 'team-state.json'), JSON.stringify({
        active: true,
        mode: 'team',
        current_phase: 'running',
      }));
      await writeFile(join(stateDir, 'run-state.json'), JSON.stringify({
        active: true,
        mode: 'team',
        current_phase: 'running',
      }));
      await writeFile(join(stateDir, 'skill-active-state.json'), JSON.stringify({
        active: true,
        skill: 'team',
        active_skills: [{ skill: 'team', phase: 'running', active: true }],
      }));

      await assert.rejects(
        () => startMode('team', 'coordinate execution', 5, wd),
        /retired.*read-only compatibility/i,
      );
      await assert.rejects(
        () => updateModeState('team', { current_phase: 'changed' }, wd),
        /retired.*read-only compatibility/i,
      );

      assert.equal((await readModeState('team', wd))?.active, true);
      assert.deepEqual(await listActiveModes(wd), []);
      assert.deepEqual(await cancelAllModes(wd), []);
      assert.equal((await readModeState('team', wd))?.active, true);
      assert.equal((await readModeState('run', wd))?.active, true);
      assert.equal((await readModeState('skill-active', wd))?.active, true);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('ignores legacy active Team state when starting a supported workflow', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'nomx-mode-ignore-retired-team-'));
    try {
      const stateDir = join(wd, '.nomx', 'state');
      await mkdir(stateDir, { recursive: true });
      await writeFile(join(stateDir, 'team-state.json'), JSON.stringify({
        active: true,
        mode: 'team',
        current_phase: 'running',
      }));
      await writeFile(join(stateDir, 'skill-active-state.json'), JSON.stringify({
        active: true,
        skill: 'team',
        active_skills: [{ skill: 'team', phase: 'running', active: true }],
      }));

      await startMode('autopilot', 'run supported automation', 5, wd);

      const autopilotState = JSON.parse(
        await readFile(join(wd, '.nomx', 'state', 'autopilot-state.json'), 'utf-8'),
      ) as { active?: boolean };
      assert.equal(autopilotState.active, true);
      assert.equal(existsSync(join(wd, '.nomx', 'state', 'team-state.json')), true);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });
});
