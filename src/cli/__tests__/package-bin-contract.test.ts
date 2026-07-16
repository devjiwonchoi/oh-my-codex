import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

type PackageJson = {
  name?: string;
  bin?: string | Record<string, string>;
  files?: string[];
  scripts?: Record<string, string>;
};

describe('package bin contract', () => {
  it('publishes only the nomx executable and no Rust workspace', () => {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ) as PackageJson;

    assert.equal(pkg.name, 'nomx');
    assert.deepEqual(pkg.bin, { nomx: 'dist/cli/nomx.js' });
    assert.equal(pkg.files?.includes('Cargo.toml'), false);
    assert.equal(pkg.files?.includes('Cargo.lock'), false);
    assert.equal(pkg.files?.includes('crates/'), false);
    assert.equal(pkg.scripts?.prepack, 'npm run build && npm run verify:native-agents && npm run sync:plugin && npm run verify:plugin-bundle');
  });

  it('packs the nomx entry without native binaries or Rust sources', () => {
    const npmCache = mkdtempSync(join(tmpdir(), 'nomx-npm-cache-'));
    try {
      const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, npm_config_cache: npmCache },
      });
      assert.equal(result.status, 0, result.stderr);
      const files = (JSON.parse(result.stdout) as Array<{ files?: Array<{ path: string }> }>)[0]?.files ?? [];
      const paths = files.map((file) => file.path);

      assert.ok(paths.includes('dist/cli/nomx.js'));
      assert.equal(paths.some((path) => path === 'Cargo.toml' || path === 'Cargo.lock'), false);
      assert.equal(paths.some((path) => path.startsWith('crates/')), false);
      assert.equal(paths.some((path) => path.startsWith('bin/native/')), false);
    } finally {
      rmSync(npmCache, { recursive: true, force: true });
    }
  });
});
