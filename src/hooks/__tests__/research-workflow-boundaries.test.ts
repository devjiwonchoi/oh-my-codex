import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf-8');
}

describe('research workflow boundary guidance', () => {
  it('keeps best-practice research positioned as pre-planning evidence, not architecture', () => {
    const skill = read('skills/best-practice-research/SKILL.md');
    assert.match(skill, /ordinary first research wrapper/i);
    assert.match(skill, /hand it to `\$ralplan` or the caller as planning input/i);
    assert.match(skill, /Do not present `\$best-practice-research` as a final architecture component/i);
  });

  it('requires ralplan to synthesize prior research instead of embedding research automation by default', () => {
    const skill = read('skills/ralplan/SKILL.md');
    assert.match(skill, /treat its approved artifact as evidence for the plan/i);
    assert.match(skill, /Do not include Autoresearch as a final architecture or runtime component/i);
    assert.match(skill, /synthesize the evidence into the `\$ralplan` ADR, risks, and verification steps/i);
  });
});
