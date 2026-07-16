import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = new URL('../../..', import.meta.url).pathname;
const skillsRoot = join(repoRoot, 'skills');

function skillContent(name: string): string {
  return readFileSync(join(skillsRoot, name, 'SKILL.md'), 'utf8');
}

function skillNames(): string[] {
  return readdirSync(skillsRoot)
    .filter((name) => statSync(join(skillsRoot, name)).isDirectory())
    .sort();
}

describe('skill catalog hygiene', () => {
  it('ships only the supported core workflow skills', () => {
    assert.deepEqual(skillNames(), [
      'autopilot',
      'best-practice-research',
      'code-review',
      'deep-interview',
      'doctor',
      'plan',
      'ralph',
      'ralplan',
      'team',
      'ultragoal',
      'ultraqa',
      'ultrawork',
      'worker',
    ]);
  });

  it('keeps the cleanup subset free of obsolete prompt/tool boilerplate', () => {
    const cleanupSubset = ['deep-interview', 'plan', 'ultraqa', 'ultrawork'];
    const obsolete = [
      /ToolSearch\(/,
      /mcp__[^\s`]+/,
      /GPT-5\.4 Guidance Alignment/,
      /Task:\s*\{\{ARGUMENTS\}\}/,
      /delegate\(role=/,
    ];

    const offenders = cleanupSubset.flatMap((name) => {
      const content = skillContent(name);
      return obsolete
        .filter((pattern) => pattern.test(content))
        .map((pattern) => `${name}: ${pattern}`);
    });

    assert.deepEqual(offenders, []);
  });

  it('keeps primary workflow guidance CLI-first instead of MCP-first', () => {
    const primaryWorkflows = [
      'autopilot',
      'code-review',
      'plan',
      'ralph',
      'ultraqa',
      'ultrawork',
    ];
    const mcpFirstPatterns = [
      /Use `nomx_state` MCP tools/i,
      /Use the `nomx_state` MCP server tools/i,
      /Before first MCP tool use, call `ToolSearch\("mcp"\)`/i,
      /If ToolSearch finds no MCP tools/i,
      /state_write MCP tool/i,
      /write subsequent updates via nomx_state MCP/i,
      /nomx state clear --mode/i,
      /nomx state state_write/i,
      /state_(?:read|write)\(mode=/i,
      /wiki_(?:ingest|query|lint|add|list|read|delete|refresh)\([^)]*\)/,
    ];

    const offenders = primaryWorkflows.flatMap((name) => {
      const content = skillContent(name);
      return mcpFirstPatterns
        .filter((pattern) => pattern.test(content))
        .map((pattern) => `${name}: ${pattern}`);
    });

    assert.deepEqual(offenders, []);
  });
});
