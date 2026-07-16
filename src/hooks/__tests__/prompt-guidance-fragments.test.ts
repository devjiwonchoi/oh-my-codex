import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTrackedAgentSurfaces } from './prompt-guidance-test-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../../');

function read(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf-8');
}

function extract(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker ${endMarker}`);
  return text.slice(start + startMarker.length, end).trim();
}

describe('embedded prompt-guidance contracts', () => {
  it('keeps shared AGENTS guidance blocks aligned', () => {
    const surfaces = listTrackedAgentSurfaces().map(read);
    for (const [startMarker, endMarker] of [
      ['<!-- NOMX:GUIDANCE:OPERATING:START -->', '<!-- NOMX:GUIDANCE:OPERATING:END -->'],
      ['<!-- NOMX:GUIDANCE:SPECIALIST-ROUTING:START -->', '<!-- NOMX:GUIDANCE:SPECIALIST-ROUTING:END -->'],
      ['<!-- NOMX:GUIDANCE:VERIFYSEQ:START -->', '<!-- NOMX:GUIDANCE:VERIFYSEQ:END -->'],
    ] as const) {
      const expected = extract(surfaces[0], startMarker, endMarker);
      assert.ok(expected.length > 0);
      for (const content of surfaces.slice(1)) {
        assert.equal(extract(content, startMarker, endMarker), expected);
      }
    }
  });

  it('keeps executor guidance embedded', () => {
    const content = read('prompts/executor.md');
    assert.ok(extract(content, '<!-- NOMX:GUIDANCE:EXECUTOR:CONSTRAINTS:START -->', '<!-- NOMX:GUIDANCE:EXECUTOR:CONSTRAINTS:END -->').length > 0);
    assert.ok(extract(content, '<!-- NOMX:GUIDANCE:EXECUTOR:OUTPUT:START -->', '<!-- NOMX:GUIDANCE:EXECUTOR:OUTPUT:END -->').length > 0);
  });

  it('keeps planner guidance embedded', () => {
    const content = read('prompts/planner.md');
    assert.ok(extract(content, '<!-- NOMX:GUIDANCE:PLANNER:CONSTRAINTS:START -->', '<!-- NOMX:GUIDANCE:PLANNER:CONSTRAINTS:END -->').length > 0);
    assert.ok(extract(content, '<!-- NOMX:GUIDANCE:PLANNER:INVESTIGATION:START -->', '<!-- NOMX:GUIDANCE:PLANNER:INVESTIGATION:END -->').length > 0);
    assert.ok(extract(content, '<!-- NOMX:GUIDANCE:PLANNER:OUTPUT:START -->', '<!-- NOMX:GUIDANCE:PLANNER:OUTPUT:END -->').length > 0);
  });

  it('keeps verifier guidance embedded', () => {
    const content = read('prompts/verifier.md');
    assert.ok(extract(content, '<!-- NOMX:GUIDANCE:VERIFIER:CONSTRAINTS:START -->', '<!-- NOMX:GUIDANCE:VERIFIER:CONSTRAINTS:END -->').length > 0);
    assert.ok(extract(content, '<!-- NOMX:GUIDANCE:VERIFIER:INVESTIGATION:START -->', '<!-- NOMX:GUIDANCE:VERIFIER:INVESTIGATION:END -->').length > 0);
  });
});
