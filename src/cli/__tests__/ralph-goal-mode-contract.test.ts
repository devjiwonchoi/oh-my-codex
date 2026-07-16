import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  LEADER_CONDUCTOR_BLOCK,
  LEADER_CONDUCTOR_GOLDEN_RULE,
  LEADER_CONDUCTOR_REUSE_AND_LEDGER_GUIDANCE,
} from '../../leader/contract.js';
import { buildRalphAppendInstructions } from '../ralph.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ralphSkill = readFileSync(join(__dirname, '../../../skills/ralph/SKILL.md'), 'utf-8');

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('ralph goal mode integration contract', () => {
  it('uses receipt-backed native spawn_agent examples instead of unsupported dispatch fields', () => {
    assert.match(ralphSkill, /native `spawn_agent` contract/i);
    assert.match(ralphSkill, /`task_name`, a precise `message`, and `fork_turns`/i);
    assert.match(ralphSkill, /role-intent write --role <role>/i);
    assert.match(ralphSkill, /role-intent write --role architect/i);
    assert.match(ralphSkill, /CODEX_THREAD_ID.*authenticated current leader identity/i);
    assert.match(ralphSkill, /--parent-thread "\$CODEX_THREAD_ID"/i);
    assert.match(ralphSkill, /receipt's `spawn_task_name` as the exact `task_name`/i);
    assert.match(ralphSkill, /validated ledger receipt carries role identity/i);
    assert.match(ralphSkill, /Never replace the receipt with a prompt role label/i);
    assert.match(
      ralphSkill,
      /spawn_agent\(\{task_name: "<receipt\.spawn_task_name>", message:/,
    );
    assert.doesNotMatch(ralphSkill, /\btask\(\s*(?:agent_type|subagent_type)\s*=/);
    assert.doesNotMatch(ralphSkill, /\brun_in_background\s*[:=]/);
    assert.doesNotMatch(ralphSkill, /\bload_skills\s*[:=]/);
    assert.doesNotMatch(ralphSkill, /\breasoning_effort\s*[:=]/);
    assert.doesNotMatch(ralphSkill, /delegate\(role=/);
    assert.doesNotMatch(ralphSkill, /delegate\(executor/);
    assert.doesNotMatch(ralphSkill, /tier="/);
    assert.doesNotMatch(ralphSkill, /(?:^|[,{]\s*)model\s*[:=]/m);
    assert.doesNotMatch(ralphSkill, /<leader-thread-id>/i);
  });

  it('documents Codex goal-mode audit and completion semantics in the Ralph skill', () => {
    assert.match(ralphSkill, /Goal Mode Integration/i);
    assert.match(ralphSkill, /get_goal/i);
    assert.match(ralphSkill, /create_goal/i);
    assert.match(ralphSkill, /update_goal\(\{status: "complete"\}\)/i);
    assert.match(ralphSkill, /prompt-to-artifact checklist/i);
    assert.match(ralphSkill, /Do not use passing tests, Ralph state, or architect approval as proxy proof/i);
    assert.match(ralphSkill, /"completion_audit":\{"passed":true/i);
    assert.match(ralphSkill, /"prompt_to_artifact_checklist":\["<requirement mapped to artifact\/evidence>"\]/i);
    assert.match(ralphSkill, /"verification_evidence":\["<fresh test\/build\/lint command and result>"\]/i);
  });

  it('injects goal-mode guidance into launched Ralph sessions', () => {
    const instructions = buildRalphAppendInstructions('ship the integration', {
      changedFilesPath: '.nomx/ralph/changed-files.txt',
      noDeslop: false,
    });

    assert.match(instructions, /Goal mode guidance/i);
    assert.match(instructions, /Conductor philosophy:/i);
    assert.match(instructions, new RegExp(escapeRegExp(LEADER_CONDUCTOR_BLOCK)));
    assert.match(instructions, new RegExp(escapeRegExp(LEADER_CONDUCTOR_GOLDEN_RULE)));
    assert.match(instructions, new RegExp(escapeRegExp(LEADER_CONDUCTOR_REUSE_AND_LEDGER_GUIDANCE)));
    assert.match(instructions, /get_goal/i);
    assert.match(instructions, /create_goal/i);
    assert.match(instructions, /update_goal\(\{status: "complete"\}\)/i);
    assert.match(instructions, /top-level completion contract/i);
    assert.match(instructions, /prompt-to-artifact checklist/i);
    assert.match(instructions, /completion_audit\.passed=true/i);
    assert.match(instructions, /completion_audit\.verification_evidence/i);
  });
});
