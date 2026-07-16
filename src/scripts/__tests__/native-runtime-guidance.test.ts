import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

async function readWorkspaceFile(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), 'utf8');
}

test('native hook guidance uses native collaboration surfaces', async () => {
  const source = await readFile(new URL('../codex-native-hook.js', import.meta.url), 'utf8');
  assert.match(source, /native Codex subagents/);
  assert.match(source, /native structured input/);
  assert.doesNotMatch(source, /nomx question/);
  assert.doesNotMatch(source, /nomx team/);
  assert.doesNotMatch(source, /attached tmux/i);
});

test('packaged workflow guidance uses native subagents instead of the removed Team runtime', async () => {
  const [
    agentsTemplate,
    autopilotSkill,
    codeReviewSkill,
    deepInterviewSkill,
    planSkill,
    ralplanSkill,
    ultragoalSkill,
    ultraworkSkill,
    plannerPrompt,
  ] = await Promise.all([
    readWorkspaceFile('templates/AGENTS.md'),
    readWorkspaceFile('skills/autopilot/SKILL.md'),
    readWorkspaceFile('skills/code-review/SKILL.md'),
    readWorkspaceFile('skills/deep-interview/SKILL.md'),
    readWorkspaceFile('skills/plan/SKILL.md'),
    readWorkspaceFile('skills/ralplan/SKILL.md'),
    readWorkspaceFile('skills/ultragoal/SKILL.md'),
    readWorkspaceFile('skills/ultrawork/SKILL.md'),
    readWorkspaceFile('prompts/planner.md'),
  ]);

  assert.doesNotMatch(agentsTemplate, /team pane/i);
  assert.match(agentsTemplate, /legacy merge compatibility/i);
  assert.match(agentsTemplate, /respect the native collaboration surface's reported concurrency capacity/i);
  assert.match(agentsTemplate, /count the leader in that total/i);
  assert.doesNotMatch(agentsTemplate, /max \d+ concurrent child agents/i);
  for (const source of [autopilotSkill, codeReviewSkill, deepInterviewSkill, planSkill, ralplanSkill]) {
    assert.match(source, /native (?:Codex )?subagents/i);
    assert.doesNotMatch(source, /\bteam\b/i);
  }
  assert.match(ultragoalSkill, /native Codex subagents/i);
  assert.doesNotMatch(ultragoalSkill, /\bTeam launch\b|\bnomx team\b|Use Ultragoal and Team/i);
  assert.match(ultraworkSkill, /native Codex subagents/i);
  assert.doesNotMatch(ultraworkSkill, /worker panes|mailbox\/dispatch|\bTeam only\b|\bteam for parallel\b/i);
  assert.doesNotMatch(ultraworkSkill, /Task needs bounded parallel execution -- use native Codex subagents/i);
  assert.match(plannerPrompt, /native-subagent staffing guidance/i);
  assert.doesNotMatch(plannerPrompt, /team follow-up|team verification/i);
});

test('interactive QA guidance uses the retained test-engineer role', async () => {
  const [ultraqaSkill, qualityStrategistPrompt, capabilityLock] = await Promise.all([
    readWorkspaceFile('skills/ultraqa/SKILL.md'),
    readWorkspaceFile('prompts/quality-strategist.md'),
    readWorkspaceFile('nomx-capabilities.lock.json'),
  ]);

  assert.match(ultraqaSkill, /test-engineer/);
  assert.doesNotMatch(ultraqaSkill, /qa-tester/);
  assert.doesNotMatch(qualityStrategistPrompt, /qa-tester/);
  assert.doesNotMatch(capabilityLock, /prompts\/qa-tester\.md/);
});
