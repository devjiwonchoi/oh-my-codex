import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../../');

function read(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf-8');
}

function assertMatchesAll(content: string, patterns: RegExp[]): void {
  for (const pattern of patterns) {
    assert.match(content, pattern);
  }
}

function assertCanonicalPluginParity(path: string): void {
  const pluginPath = `plugins/nomx/${path}`;
  assert.ok(existsSync(join(repoRoot, pluginPath)), `${pluginPath} must exist in the plugin mirror`);
  assert.equal(read(pluginPath), read(path), `${path} must match the plugin mirror exactly`);
}

const antiSlopWorkingAgreementPatterns = [
  /^## Working agreements$/m,
  /^- For cleanup\/refactor\/deslop work, write a cleanup plan and lock behavior with regression tests before editing when coverage is missing\.$/m,
  /^- Prefer deletion, existing utilities, and existing patterns before new abstractions; add dependencies only when explicitly requested\.$/m,
  /^- Keep diffs small, reviewable, and reversible\.$/m,
  /^- Verify with lint, typecheck, tests, and static analysis after changes; final reports include changed files, simplifications, and remaining risks\.$/m,
];

const antiSlopWorkflowPatterns = [
  /^Anti-slop workflow:$/m,
  /^- Cleanup\/refactor work follows the same `\$deep-interview` -> `\$ralplan` -> `\$team`\/`\$ralph` path with regression tests first and a bounded changed-files-only cleanup pass inside the chosen execution lane\.$/m,
  /^- Write a cleanup plan before modifying code; lock existing behavior with regression tests first, then make one smell-focused pass at a time\.$/m,
  /^- Prefer deletion over addition, and prefer reuse plus boundary repair over new layers\.$/m,
  /^- No new dependencies without explicit request\.$/m,
  /^- Run lint, typecheck, tests, and static analysis before claiming completion\.$/m,
  /^- Keep writer\/reviewer pass separation for cleanup plans and approvals; preserve writer\/reviewer pass separation explicitly\.$/m,
];

describe('anti-slop workflow surfaces', () => {
  it('adds durable anti-slop guidance to AGENTS surfaces', () => {
    const templateContent = read('templates/AGENTS.md');
    assertMatchesAll(templateContent, antiSlopWorkingAgreementPatterns);
    assertMatchesAll(templateContent, antiSlopWorkflowPatterns);

    if (existsSync(join(repoRoot, 'AGENTS.md'))) {
      const content = read('AGENTS.md');
      if (/^## Working agreements$/m.test(content)) {
        assertMatchesAll(content, antiSlopWorkingAgreementPatterns);
      }
    }
  });

  it('documents reviewer-only separation in plan review mode', () => {
    assertCanonicalPluginParity('skills/plan/SKILL.md');

    const planSkill = read('skills/plan/SKILL.md');

    assertMatchesAll(planSkill, [
      /### Review Mode \(`--review`\)/,
      /reviewer-only\s+pass/i,
      /MUST\s+NOT\s+be\s+the\s+context\s+that\s+approves\s+it/i,
      /cleanup\s+plan,\s*regression\s+tests/i,
    ]);
  });

});
