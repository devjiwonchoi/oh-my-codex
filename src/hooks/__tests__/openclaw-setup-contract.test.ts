import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(
  join(__dirname, '../../../skills/configure-notifications/SKILL.md'),
  'utf-8',
);

describe('OpenClaw setup skill contract', () => {
  it('keeps delivery and wake verification guidance', () => {
    assert.match(skill, /\/hooks\/agent/);
    assert.match(skill, /\/hooks\/wake/);
  });

  it('keeps compatibility, aliases, and explicit configuration precedence', () => {
    assert.match(skill, /Compatibility \+ precedence contract/);
    assert.match(skill, /custom_webhook_command/);
    assert.match(skill, /custom_cli_command/);
    assert.match(skill, /notifications\.openclaw[\s\S]*wins/);
  });

  it('keeps command-gateway operational guidance', () => {
    assert.match(skill, /clawdbot agent/);
    assert.match(skill, /한국어/);
    assert.match(skill, /\{\{tmuxSession\}\}/);
    assert.match(skill, /SOUL\.md/);
  });
});
