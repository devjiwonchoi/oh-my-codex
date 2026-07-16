import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
    assert.equal(pkg.scripts?.prepack, 'npm run build && npm run verify:native-agents && npm run sync:plugin && npm run verify:plugin-bundle && npm run verify:capabilities-lock');
  });

  it('keeps every compiled test target in package scripts backed by a source test', () => {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ) as PackageJson;
    const targets = Object.entries(pkg.scripts ?? {}).flatMap(([scriptName, command]) =>
      [...command.matchAll(/\bdist\/[^\s'\"]+\.test\.js\b/g)].map((match) => ({
        scriptName,
        compiledPath: match[0],
      })),
    );

    assert.ok(targets.length > 0, 'expected package scripts to contain compiled test targets');
    for (const target of targets) {
      const sourcePath = target.compiledPath
        .replace(/^dist\//, 'src/')
        .replace(/\.js$/, '.ts');
      assert.equal(
        existsSync(join(process.cwd(), sourcePath)),
        true,
        `${target.scriptName} references missing test source ${sourcePath}`,
      );
    }
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
