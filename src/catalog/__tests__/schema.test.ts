import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { summarizeCatalogCounts, validateCatalogManifest } from '../schema.js';

function readSourceManifest(): unknown {
  const path = join(process.cwd(), 'src', 'catalog', 'manifest.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('catalog schema', () => {
  const retainedSkills = [
    'ai-slop-cleaner',
    'autopilot',
    'best-practice-research',
    'code-review',
    'deep-interview',
    'doctor',
    'plan',
    'ralph',
    'ralplan',
    'ultragoal',
    'ultraqa',
    'ultrawork',
  ];

  it('validates repository manifest', () => {
    const parsed = validateCatalogManifest(readSourceManifest());
    assert.equal(parsed.schemaVersion, 1);
    assert.ok(parsed.catalogVersion.length > 0);
    assert.ok(parsed.skills.length > 0);
    assert.ok(parsed.agents.length > 0);
  });

  it('enforces required core skills as active', () => {
    const broken = JSON.parse(JSON.stringify(readSourceManifest()));
    const idx = broken.skills.findIndex((s: { name: string }) => s.name === 'ralplan');
    broken.skills[idx].status = 'deprecated';
    assert.throws(() => validateCatalogManifest(broken), /missing_core_skill:ralplan/);
  });

  it('requires canonical for alias/merged skill entries', () => {
    const broken = JSON.parse(JSON.stringify(readSourceManifest()));
    broken.skills.push({
      name: 'tmp-alias',
      category: 'utility',
      status: 'alias',
      core: false,
      internalRequired: false,
    });

    assert.throws(
      () => validateCatalogManifest(broken),
      /skills\[\d+\]\.canonical/,
    );
  });

  it('requires canonical for alias/merged agent entries', () => {
    const broken = JSON.parse(JSON.stringify(readSourceManifest()));
    broken.agents.push({
      name: 'tmp-merged-agent',
      category: 'build',
      status: 'merged',
    });

    assert.throws(
      () => validateCatalogManifest(broken),
      /agents\[\d+\]\.canonical/,
    );
  });

  it('summarizes counts', () => {
    const parsed = validateCatalogManifest(readSourceManifest());
    const counts = summarizeCatalogCounts(parsed);
    assert.equal(counts.skillCount, parsed.skills.length);
    assert.equal(counts.promptCount, parsed.agents.length);
    assert.ok(counts.activeSkillCount > 0);
    assert.ok(counts.activeAgentCount > 0);
  });

  it('exposes only the retained core and supporting skills', () => {
    const parsed = validateCatalogManifest(readSourceManifest());
    assert.deepEqual(parsed.skills.map((skill) => skill.name).sort(), retainedSkills);
  });

  it('includes ultragoal as a core execution skill', () => {
    const parsed = validateCatalogManifest(readSourceManifest());
    const ultragoal = parsed.skills.find((skill) => skill.name === 'ultragoal');

    assert.equal(ultragoal?.category, 'execution');
    assert.equal(ultragoal?.status, 'active');
    assert.equal(ultragoal?.core, true);
  });
});
