import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function runOmx(cwd: string, argv: string[]) {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(testDir, '..', '..', '..');
  const nomxBin = join(repoRoot, 'dist', 'cli', 'nomx.js');
  return spawnSync(process.execPath, [nomxBin, ...argv], {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      NOMX_AUTO_UPDATE: '0',
      NOMX_NOTIFY_FALLBACK: '0',
      NOMX_HOOK_DERIVED_SIGNALS: '0',
    },
  });
}

describe('nested help routing', () => {
  for (const [argv, expectedUsage] of [
    [['hud', '--help'], /Usage:\s*\n\s*nomx hud\s+Show current HUD state/i],
    [['hooks', '--help'], /Usage:\s*\n\s*nomx hooks init/i],
    [['state', '--help'], /Usage:\s*nomx state <read\|write\|clear\|list-active\|get-status>/i],
    [['notepad', '--help'], /Usage:\s*nomx notepad <tool-name>[\s\S]*Available tools:[\s\S]*notepad_read/i],
    [['project-memory', '--help'], /Usage:\s*nomx project-memory <tool-name>[\s\S]*Available tools:[\s\S]*project_memory_read/i],
    [['trace', '--help'], /Usage:\s*nomx trace <tool-name>[\s\S]*Available tools:[\s\S]*trace_timeline/i],
    [['code-intel', '--help'], /Usage:\s*nomx code-intel <tool-name>[\s\S]*Available tools:[\s\S]*lsp_diagnostics/i],
    [['mcp-serve', '--help'], /Usage:\s*nomx mcp-serve <target>/i],
    [['ralph', '--help'], /nomx ralph - Launch Codex with ralph persistence mode active/i],
  ] satisfies Array<[string[], RegExp]>) {
    it(`routes ${argv.join(' ')} to command-local help`, async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'nomx-nested-help-'));
      try {
        const result = runOmx(cwd, argv);
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.match(result.stdout, expectedUsage);
        assert.doesNotMatch(result.stdout, /nomx \(nomx\) - Multi-agent orchestration for Codex CLI/i);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });
  }

  it('routes `nomx state read` through the top-level CLI', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nomx-state-route-'));
    try {
      const result = runOmx(cwd, ['state', 'read', '--input', '{"mode":"ralph"}', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout.trim(), /^\{"exists":false,"mode":"ralph"\}$/);
      assert.doesNotMatch(result.stdout, /Unknown command: state/i);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
