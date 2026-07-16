import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { HELP, normalizeCodexLaunchArgs } from '../index.js';

test('CLI advertises only retained non-tmux orchestration surfaces', () => {
  assert.doesNotMatch(HELP, /nomx (?:team|question|tmux-hook)\b/);
  assert.doesNotMatch(HELP, /tmux/i);
  assert.match(HELP, /nomx hud\s+Show HUD statusline/);
  assert.match(HELP, /nomx agents\s+Manage Codex native agent/);
});

test('normal launch arguments are passed directly to Codex', () => {
  assert.deepEqual(normalizeCodexLaunchArgs(['--model', 'gpt-5']), ['--model', 'gpt-5']);
});

test('central CLI contains no tmux or Team runtime dependency', async () => {
  const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /tmux/i);
  assert.doesNotMatch(source, /\.\.\/team\//);
});
