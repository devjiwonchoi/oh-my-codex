import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { generateOverlay, resolveSessionOrchestrationMode } from '../agents-overlay.js';

test('runtime overlay advertises native subagent routing without Team runtime', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'nomx-overlay-native-'));
  try {
    const overlay = await generateOverlay(cwd, 'native-session');
    assert.match(overlay, /Native Subagent Routing/);
    assert.match(overlay, /native surface exposes `agent_type`/);
    assert.doesNotMatch(overlay, /Orchestration Mode.*team/i);
    assert.equal(await resolveSessionOrchestrationMode(cwd, 'native-session'), 'default');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
