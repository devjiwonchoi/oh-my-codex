import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('native hook guidance uses native collaboration surfaces', async () => {
  const source = await readFile(new URL('../codex-native-hook.js', import.meta.url), 'utf8');
  assert.match(source, /native Codex subagents/);
  assert.match(source, /native structured input/);
  assert.doesNotMatch(source, /nomx question/);
  assert.doesNotMatch(source, /nomx team/);
  assert.doesNotMatch(source, /attached tmux/i);
});
