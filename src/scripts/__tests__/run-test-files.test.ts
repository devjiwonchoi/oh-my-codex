import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function runCompiledRunner(root: string, envOverrides: Record<string, string> = {}, timeoutMs = 15_000) {
  return spawnSync(process.execPath, ['dist/scripts/run-test-files.js', root], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    env: {
      ...process.env,
      ...envOverrides,
    },
    timeout: timeoutMs,
  });
}

describe('run-test-files diagnostics', () => {
  it('applies a bounded node --test timeout so hanging tests fail with file context', () => {
    const wd = mkdtempSync(join(tmpdir(), 'nomx-run-test-files-'));
    try {
      const testsDir = join(wd, '__tests__');
      mkdirSync(testsDir, { recursive: true });
      const testPath = join(testsDir, 'hang.test.js');
      writeFileSync(
        testPath,
        [
          "import { test } from 'node:test';",
          "test('never resolves', async () => { await new Promise(() => setInterval(() => {}, 1_000)); });",
          '',
        ].join('\n'),
      );

      const result = runCompiledRunner(wd, {
        NOMX_NODE_TEST_TIMEOUT_MS: '250',
        NOMX_NODE_TEST_RUNNER_TIMEOUT_MS: '750',
      });

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /per-test timeout 250ms/);
      assert.match(result.stderr, /node --test did not exit normally|runner timeout 750ms/);
      assert.match(`${result.stdout}\n${result.stderr}`, /hang\.test\.js|never resolves|cancelled/i);
    } finally {
      rmSync(wd, { recursive: true, force: true });
    }
  });


  it('can force-exit Node test runner after successful CI tests to avoid leaked-handle hangs', () => {
    const wd = mkdtempSync(join(tmpdir(), 'nomx-run-test-files-'));
    try {
      const testsDir = join(wd, '__tests__');
      mkdirSync(testsDir, { recursive: true });
      writeFileSync(
        join(testsDir, 'leaky-pass.test.js'),
        [
          "import { test } from 'node:test';",
          "test('passes but leaves an interval', () => { setInterval(() => {}, 1_000); });",
          '',
        ].join('\n'),
      );

      const withoutForceExit = runCompiledRunner(wd, { NOMX_NODE_TEST_RUNNER_TIMEOUT_MS: '750' }, 2_000);
      assert.notEqual(withoutForceExit.status, 0);
      assert.match(withoutForceExit.stderr, /force exit disabled/);
      assert.match(withoutForceExit.stderr, /did not exit normally|runner timeout 750ms/);

      const withForceExit = runCompiledRunner(
        wd,
        { NOMX_NODE_TEST_RUNNER_TIMEOUT_MS: '750', NOMX_NODE_TEST_FORCE_EXIT: '1' },
        2_000,
      );
      assert.equal(withForceExit.status, 0, withForceExit.stderr || withForceExit.stdout);
      assert.match(withForceExit.stderr, /force exit enabled/);
    } finally {
      rmSync(wd, { recursive: true, force: true });
    }
  });

  it('script-level force exit terminates a completed test child that blocks process exit', () => {
    const wd = mkdtempSync(join(tmpdir(), 'nomx-run-test-files-'));
    try {
      const testsDir = join(wd, '__tests__');
      mkdirSync(testsDir, { recursive: true });
      const testPath = join(testsDir, 'exit-block.test.js');
      writeFileSync(
        testPath,
        [
          "import { test } from 'node:test';",
          `test(${JSON.stringify(testPath)}, () => { process.on('exit', () => { while (true) {} }); });`,
          '',
        ].join('\n'),
      );

      const result = runCompiledRunner(
        wd,
        {
          NOMX_NODE_TEST_FORCE_EXIT: '1',
          NOMX_NODE_TEST_FORCE_EXIT_GRACE_MS: '100',
          NOMX_NODE_TEST_RUNNER_TIMEOUT_MS: '2000',
        },
        4_000,
      );

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /ok 1 - .*exit-block\.test\.js/);
      assert.match(result.stderr, /TAP ok 1 with no later failures/);
    } finally {
      rmSync(wd, { recursive: true, force: true });
    }
  });

  it('cancels script-level force exit when a later TAP failure appears', () => {
    const wd = mkdtempSync(join(tmpdir(), 'nomx-run-test-files-'));
    try {
      const testsDir = join(wd, '__tests__');
      mkdirSync(testsDir, { recursive: true });
      writeFileSync(
        join(testsDir, 'late-fail.test.js'),
        [
          "import { test } from 'node:test';",
          "import assert from 'node:assert/strict';",
          "test('passes first', () => {});",
          "test('fails shortly after the first ok line', async () => {",
          "  await new Promise((resolve) => setTimeout(resolve, 25));",
          "  assert.equal(1, 2);",
          "});",
          '',
        ].join('\n'),
      );

      const result = runCompiledRunner(
        wd,
        {
          NOMX_NODE_TEST_FORCE_EXIT: '1',
          NOMX_NODE_TEST_FORCE_EXIT_GRACE_MS: '200',
          NOMX_NODE_TEST_RUNNER_TIMEOUT_MS: '2000',
        },
        4_000,
      );

      assert.notEqual(result.status, 0);
      assert.match(result.stdout, /not ok|# fail [1-9]/);
    } finally {
      rmSync(wd, { recursive: true, force: true });
    }
  });

  it('preserves failing test status when script-level force exit is enabled', () => {
    const wd = mkdtempSync(join(tmpdir(), 'nomx-run-test-files-'));
    try {
      const testsDir = join(wd, '__tests__');
      mkdirSync(testsDir, { recursive: true });
      writeFileSync(
        join(testsDir, 'fail.test.js'),
        [
          "import { test } from 'node:test';",
          "import assert from 'node:assert/strict';",
          "test('fails', () => { assert.equal(1, 2); });",
          '',
        ].join('\n'),
      );

      const result = runCompiledRunner(
        wd,
        {
          NOMX_NODE_TEST_FORCE_EXIT: '1',
          NOMX_NODE_TEST_FORCE_EXIT_GRACE_MS: '100',
          NOMX_NODE_TEST_RUNNER_TIMEOUT_MS: '2000',
        },
        4_000,
      );

      assert.notEqual(result.status, 0);
      assert.match(result.stdout, /not ok|# fail [1-9]/);
    } finally {
      rmSync(wd, { recursive: true, force: true });
    }
  });

  it('applies the runner timeout per test file instead of skipping later files after cumulative runtime', () => {
    const wd = mkdtempSync(join(tmpdir(), 'nomx-run-test-files-'));
    try {
      const testsDir = join(wd, '__tests__');
      mkdirSync(testsDir, { recursive: true });
      for (const name of ['a-slow-pass.test.js', 'b-slow-pass.test.js']) {
        writeFileSync(
          join(testsDir, name),
          [
            "import { test } from 'node:test';",
            "test('passes after a short delay', async () => {",
            "  await new Promise((resolve) => setTimeout(resolve, 450));",
            "});",
            '',
          ].join('\n'),
        );
      }

      const result = runCompiledRunner(wd, { NOMX_NODE_TEST_RUNNER_TIMEOUT_MS: '750' }, 3_000);

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.doesNotMatch(result.stderr, /timeout before/);
    } finally {
      rmSync(wd, { recursive: true, force: true });
    }
  });

  it('logs that per-test timeout is disabled by default', () => {
    const wd = mkdtempSync(join(tmpdir(), 'nomx-run-test-files-'));
    try {
      const testsDir = join(wd, '__tests__');
      mkdirSync(testsDir, { recursive: true });
      writeFileSync(
        join(testsDir, 'pass.test.js'),
        [
          "import { test } from 'node:test';",
          "test('passes', () => {});",
          '',
        ].join('\n'),
      );

      const result = runCompiledRunner(wd);

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stderr, /per-test timeout disabled/);
    } finally {
      rmSync(wd, { recursive: true, force: true });
    }
  });

  it('serializes local test files by default to avoid runaway full-suite fan-out', () => {
    const wd = mkdtempSync(join(tmpdir(), 'nomx-run-test-files-'));
    try {
      const testsDir = join(wd, '__tests__');
      mkdirSync(testsDir, { recursive: true });
      writeFileSync(
        join(testsDir, 'pass.test.js'),
        [
          "import { test } from 'node:test';",
          "test('passes', () => {});",
          '',
        ].join('\n'),
      );

      const result = runCompiledRunner(wd, { CI: 'false', GITHUB_ACTIONS: 'false' });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stderr, /test concurrency 1/);
    } finally {
      rmSync(wd, { recursive: true, force: true });
    }
  });

  it('serializes test files by default in CI to avoid cross-file child-process leaks', () => {
    const wd = mkdtempSync(join(tmpdir(), 'nomx-run-test-files-'));
    try {
      const testsDir = join(wd, '__tests__');
      mkdirSync(testsDir, { recursive: true });
      writeFileSync(
        join(testsDir, 'pass.test.js'),
        [
          "import { test } from 'node:test';",
          "test('passes', () => {});",
          '',
        ].join('\n'),
      );

      const result = runCompiledRunner(wd, { CI: 'true' });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stderr, /test concurrency 1/);
    } finally {
      rmSync(wd, { recursive: true, force: true });
    }
  });

  it('honors an explicit test concurrency override in CI', () => {
    const wd = mkdtempSync(join(tmpdir(), 'nomx-run-test-files-'));
    try {
      const testsDir = join(wd, '__tests__');
      mkdirSync(testsDir, { recursive: true });
      writeFileSync(
        join(testsDir, 'pass.test.js'),
        [
          "import { test } from 'node:test';",
          "test('passes', () => {});",
          '',
        ].join('\n'),
      );

      const result = runCompiledRunner(wd, { CI: 'true', NOMX_NODE_TEST_CONCURRENCY: '2' });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stderr, /test concurrency 2/);
    } finally {
      rmSync(wd, { recursive: true, force: true });
    }
  });

  it('isolates process env mutations between test files', () => {
    const wd = mkdtempSync(join(tmpdir(), 'nomx-run-test-files-'));
    try {
      const testsDir = join(wd, '__tests__');
      mkdirSync(testsDir, { recursive: true });
      writeFileSync(
        join(testsDir, 'a-mutate-env.test.js'),
        [
          "import { test } from 'node:test';",
          "test('mutates process env', () => { process.env.NOMX_TEST_FILE_LEAK = 'leaked'; });",
          '',
        ].join('\n'),
      );
      writeFileSync(
        join(testsDir, 'b-observe-env.test.js'),
        [
          "import { test } from 'node:test';",
          "import assert from 'node:assert/strict';",
          "test('does not inherit prior file env mutation', () => {",
          "  assert.equal(process.env.NOMX_TEST_FILE_LEAK, undefined);",
          "});",
          '',
        ].join('\n'),
      );

      const result = runCompiledRunner(wd);

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stderr, /per-file process isolation/);
    } finally {
      rmSync(wd, { recursive: true, force: true });
    }
  });

  it('sanitizes live NOMX runtime state env from child test processes by default', () => {
    const wd = mkdtempSync(join(tmpdir(), 'nomx-run-test-files-'));
    try {
      const testsDir = join(wd, '__tests__');
      mkdirSync(testsDir, { recursive: true });
      writeFileSync(
        join(testsDir, 'env-clean.test.js'),
        [
          "import { test } from 'node:test';",
          "import assert from 'node:assert/strict';",
          "test('runtime env is clean', () => {",
          "  assert.equal(process.env.NOMX_ROOT, undefined);",
          "  assert.equal(process.env.NOMX_STATE_ROOT, undefined);",
          "  assert.equal(process.env.NOMX_TEAM_STATE_ROOT, undefined);",
          "  assert.equal(process.env.NOMX_SESSION_ID, undefined);",
          "  assert.equal(process.env.NOMX_RUNS_DIR, undefined);",
          "  assert.equal(process.env.OMXBOX_ACTIVE, undefined);",
          "  assert.equal(process.env.NOMX_MADMAX_DETACHED_CONTEXT, undefined);",
          "  assert.equal(process.env.NOMX_DEFAULT_STANDARD_MODEL, undefined);",
          "  assert.equal(process.env.USE_OMX_EXPLORE_CMD, undefined);",
          "  assert.equal(process.env.CODEX_SESSION_ID, undefined);",
          "  assert.equal(process.env.CODEX_HOME, undefined);",
          "  assert.equal(process.env.SESSION_ID, undefined);",
          "  assert.equal(process.env.TMUX, undefined);",
          "  assert.equal(process.env.TMUX_PANE, undefined);",
          "});",
          '',
        ].join('\n'),
      );

      const result = runCompiledRunner(wd, {
        NOMX_ROOT: '/tmp/live-nomx-root',
        NOMX_STATE_ROOT: '/tmp/live-nomx-state-root',
        NOMX_TEAM_STATE_ROOT: '/tmp/live-team-state-root',
        NOMX_SESSION_ID: 'live-nomx-session',
        NOMX_RUNS_DIR: '/tmp/live-nomx-runs',
        OMXBOX_ACTIVE: '1',
        NOMX_MADMAX_DETACHED_CONTEXT: 'live-context',
        NOMX_DEFAULT_STANDARD_MODEL: 'ambient-model',
        USE_OMX_EXPLORE_CMD: '1',
        CODEX_SESSION_ID: 'live-codex-session',
        CODEX_HOME: '/tmp/live-codex-home',
        SESSION_ID: 'live-shell-session',
        TMUX: '/tmp/live-tmux,1,2',
        TMUX_PANE: '%live',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
    } finally {
      rmSync(wd, { recursive: true, force: true });
    }
  });

  it('preserves explicit test-runner controls and explore harness override while scrubbing live runtime env', () => {
    const wd = mkdtempSync(join(tmpdir(), 'nomx-run-test-files-'));
    try {
      const testsDir = join(wd, '__tests__');
      mkdirSync(testsDir, { recursive: true });
      writeFileSync(
        join(testsDir, 'env-allowlist.test.js'),
        [
          "import { test } from 'node:test';",
          "import assert from 'node:assert/strict';",
          "test('runner env allowlist is narrow', () => {",
          "  assert.equal(process.env.NOMX_EXPLORE_BIN, '/tmp/fake-explore');",
          "  assert.equal(process.env.NOMX_NODE_TEST_CONCURRENCY, '1');",
          "  assert.equal(process.env.NOMX_ROOT, undefined);",
          "  assert.equal(process.env.CODEX_HOME, undefined);",
          "});",
          '',
        ].join('\n'),
      );

      const result = runCompiledRunner(wd, {
        NOMX_EXPLORE_BIN: '/tmp/fake-explore',
        NOMX_NODE_TEST_CONCURRENCY: '1',
        NOMX_ROOT: '/tmp/live-nomx-root',
        CODEX_HOME: '/tmp/live-codex-home',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
    } finally {
      rmSync(wd, { recursive: true, force: true });
    }
  });

  it('can preserve live NOMX runtime state env for explicit diagnostics', () => {
    const wd = mkdtempSync(join(tmpdir(), 'nomx-run-test-files-'));
    try {
      const testsDir = join(wd, '__tests__');
      mkdirSync(testsDir, { recursive: true });
      writeFileSync(
        join(testsDir, 'env-preserve.test.js'),
        [
          "import { test } from 'node:test';",
          "import assert from 'node:assert/strict';",
          "test('runtime env is preserved', () => {",
          "  assert.equal(process.env.NOMX_ROOT, '/tmp/live-nomx-root');",
          "  assert.equal(process.env.NOMX_SESSION_ID, 'live-nomx-session');",
          "  assert.equal(process.env.USE_OMX_EXPLORE_CMD, '1');",
          "  assert.equal(process.env.CODEX_HOME, '/tmp/live-codex-home');",
          "});",
          '',
        ].join('\n'),
      );

      const result = runCompiledRunner(wd, {
        NOMX_NODE_TEST_PRESERVE_RUNTIME_ENV: '1',
        NOMX_ROOT: '/tmp/live-nomx-root',
        NOMX_SESSION_ID: 'live-nomx-session',
        USE_OMX_EXPLORE_CMD: '1',
        CODEX_HOME: '/tmp/live-codex-home',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
    } finally {
      rmSync(wd, { recursive: true, force: true });
    }
  });
});
