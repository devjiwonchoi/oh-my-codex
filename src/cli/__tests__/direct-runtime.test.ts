import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  HELP,
  ensureLaunchWorktree,
  normalizeCodexLaunchArgs,
  parseLaunchWorktreeMode,
  planLaunchWorktreeTarget,
  resolveCliInvocation,
} from '../index.js';

test('CLI advertises only retained non-tmux orchestration surfaces', () => {
  assert.doesNotMatch(HELP, /nomx (?:team|question|tmux-hook)\b/);
  assert.doesNotMatch(HELP, /tmux/i);
  assert.match(HELP, /nomx hud\s+Show HUD statusline/);
  assert.match(HELP, /nomx agents\s+Manage Codex native agent/);
  assert.doesNotMatch(HELP, /spark model for workers/i);
});

test('normal launch arguments are passed directly to Codex', () => {
  assert.deepEqual(normalizeCodexLaunchArgs(['--model', 'gpt-5']), ['--model', 'gpt-5']);
});

test('short Codex flags are routed to the direct launch', () => {
  assert.deepEqual(resolveCliInvocation(['-w']), {
    command: 'launch',
    launchArgs: ['-w'],
  });
  assert.deepEqual(resolveCliInvocation(['-c', 'model_reasoning_effort="high"']), {
    command: 'launch',
    launchArgs: ['-c', 'model_reasoning_effort="high"'],
  });
});

test('launch worktree flags are parsed and never forwarded to Codex', () => {
  assert.deepEqual(parseLaunchWorktreeMode(['-w', '--yolo']), {
    mode: { enabled: true, detached: true, name: null },
    remainingArgs: ['--yolo'],
  });
  assert.deepEqual(parseLaunchWorktreeMode(['-w', 'fix this bug']), {
    mode: { enabled: true, detached: true, name: null },
    remainingArgs: ['fix this bug'],
  });
  assert.deepEqual(parseLaunchWorktreeMode(['--worktree=feature/demo', '--model', 'gpt-5']), {
    mode: { enabled: true, detached: false, name: 'feature/demo' },
    remainingArgs: ['--model', 'gpt-5'],
  });
  assert.deepEqual(normalizeCodexLaunchArgs(['-w', '--yolo']), ['--yolo']);
  assert.deepEqual(
    normalizeCodexLaunchArgs(['--worktree=feature/demo', '--model', 'gpt-5']),
    ['--model', 'gpt-5'],
  );
  assert.deepEqual(parseLaunchWorktreeMode(['--', '--worktree=prompt-text', '-w']), {
    mode: { enabled: false },
    remainingArgs: ['--', '--worktree=prompt-text', '-w'],
  });
});

test('spark shorthands select the direct Codex model', () => {
  const options = { sparkModel: 'gpt-test-spark' };
  assert.deepEqual(normalizeCodexLaunchArgs(['--spark'], options), [
    '--model',
    'gpt-test-spark',
  ]);
  assert.deepEqual(normalizeCodexLaunchArgs(['--madmax-spark'], options), [
    '--dangerously-bypass-approvals-and-sandbox',
    '--model',
    'gpt-test-spark',
  ]);
  assert.deepEqual(normalizeCodexLaunchArgs(['--spark', '--model', 'gpt-explicit'], options), [
    '--model',
    'gpt-explicit',
  ]);
  assert.deepEqual(normalizeCodexLaunchArgs(['--spark', '--', 'fix', '--worktree=prompt-text'], options), [
    '--model',
    'gpt-test-spark',
    '--',
    'fix',
    '--worktree=prompt-text',
  ]);
  assert.deepEqual(normalizeCodexLaunchArgs(['--', '--spark', '--madmax', '-w'], options), [
    '--',
    '--spark',
    '--madmax',
    '-w',
  ]);
});

test('launch worktrees are created outside the repo and safely reused when dirty', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nomx-direct-worktree-'));
  const repoRoot = join(root, 'repo');
  await mkdir(repoRoot);
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
  await writeFile(join(repoRoot, 'tracked.txt'), 'initial\n');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=NOMX Test', '-c', 'user.email=nomx@example.test', 'commit', '-m', 'initial'],
    { cwd: repoRoot, stdio: 'ignore' },
  );

  const plan = planLaunchWorktreeTarget({
    cwd: repoRoot,
    mode: { enabled: true, detached: true, name: null },
  });
  assert.equal(plan.enabled, true);
  if (!plan.enabled) return;
  assert.equal(
    plan.worktreePath,
    join(
      await realpath(root),
      'repo.nomx-worktrees',
      `launch-detached-${plan.baseRef.slice(0, 12)}`,
    ),
  );

  const created = ensureLaunchWorktree(plan, { allowDirtyReuse: true });
  assert.equal(created.enabled, true);
  if (!created.enabled) return;
  assert.equal(created.created, true);
  assert.equal(created.reused, false);

  await writeFile(join(created.worktreePath, 'dirty.txt'), 'dirty\n');
  const reused = ensureLaunchWorktree(plan, { allowDirtyReuse: true });
  assert.equal(reused.enabled, true);
  if (!reused.enabled) return;
  assert.equal(reused.created, false);
  assert.equal(reused.reused, true);
  assert.equal(reused.dirty, true);

  await writeFile(join(repoRoot, 'tracked.txt'), 'next revision\n');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=NOMX Test', '-c', 'user.email=nomx@example.test', 'commit', '-m', 'next'],
    { cwd: repoRoot, stdio: 'ignore' },
  );
  const nextPlan = planLaunchWorktreeTarget({
    cwd: repoRoot,
    mode: { enabled: true, detached: true, name: null },
  });
  assert.equal(nextPlan.enabled, true);
  if (!nextPlan.enabled) return;
  assert.notEqual(nextPlan.worktreePath, plan.worktreePath);
  const nextCreated = ensureLaunchWorktree(nextPlan, { allowDirtyReuse: true });
  assert.equal(nextCreated.enabled, true);
  if (!nextCreated.enabled) return;
  assert.equal(nextCreated.created, true);
});

test('central CLI contains no tmux or Team runtime dependency', async () => {
  const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /tmux/i);
  assert.doesNotMatch(source, /\.\.\/team\//);
});
