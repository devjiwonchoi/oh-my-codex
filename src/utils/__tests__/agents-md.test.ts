import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addGeneratedAgentsMarker,
  hasOmxAgentsContract,
  hasOmxManagedAgentsSections,
  isOmxGeneratedAgentsMd,
  NOMX_GENERATED_AGENTS_MARKER,
  NOMX_AGENTS_CONTRACT_HEADING,
  extractUserOmxPolicyBlocks,
  NOMX_MANAGED_AGENTS_END_MARKER,
  NOMX_MANAGED_AGENTS_START_MARKER,
  NOMX_USER_POLICY_END_MARKER,
  NOMX_USER_POLICY_START_MARKER,
  preserveUserOmxPolicyBlocks,
} from '../agents-md.js';

describe('agents-md helpers', () => {
  it('inserts the generated marker after the autonomy directive block', () => {
    const content = [
      '<!-- AUTONOMY DIRECTIVE — DO NOT REMOVE -->',
      'YOU ARE AN AUTONOMOUS CODING AGENT. EXECUTE TASKS TO COMPLETION WITHOUT ASKING FOR PERMISSION.',
      'DO NOT STOP TO ASK "SHOULD I PROCEED?" — PROCEED. DO NOT WAIT FOR CONFIRMATION ON OBVIOUS NEXT STEPS.',
      'IF BLOCKED, TRY AN ALTERNATIVE APPROACH. ONLY ASK WHEN TRULY AMBIGUOUS OR DESTRUCTIVE.',
      '<!-- END AUTONOMY DIRECTIVE -->',
      NOMX_AGENTS_CONTRACT_HEADING,
    ].join('\n');

    const result = addGeneratedAgentsMarker(content);

    assert.match(
      result,
      /<!-- END AUTONOMY DIRECTIVE -->\n<!-- nomx:generated:agents-md -->\n# nomx - Intelligent Multi-Agent Orchestration/,
    );
  });

  it('preserves CRLF line endings when inserting the generated marker', () => {
    const content = [
      '<!-- AUTONOMY DIRECTIVE - DO NOT REMOVE -->',
      'directive body',
      '<!-- END AUTONOMY DIRECTIVE -->',
      '# Workspace instructions',
    ].join('\r\n');

    const result = addGeneratedAgentsMarker(content);

    assert.equal(
      result,
      [
        '<!-- AUTONOMY DIRECTIVE - DO NOT REMOVE -->',
        'directive body',
        '<!-- END AUTONOMY DIRECTIVE -->',
        NOMX_GENERATED_AGENTS_MARKER,
        '# Workspace instructions',
      ].join('\r\n'),
    );
  });

  it('does not duplicate an existing generated marker', () => {
    const content = `header\n${NOMX_GENERATED_AGENTS_MARKER}\nbody\n`;
    assert.equal(addGeneratedAgentsMarker(content), content);
  });

  it('does not treat a standalone generated marker as the full NOMX contract', () => {
    const content = `header\n${NOMX_GENERATED_AGENTS_MARKER}\nbody\n`;

    assert.equal(isOmxGeneratedAgentsMd(content), true);
    assert.equal(hasOmxAgentsContract(content), false);
  });

  it('treats autonomy-directive generated files as NOMX-managed once marked', () => {
    const content = [
      '<!-- AUTONOMY DIRECTIVE — DO NOT REMOVE -->',
      'directive body',
      '<!-- END AUTONOMY DIRECTIVE -->',
      NOMX_GENERATED_AGENTS_MARKER,
      NOMX_AGENTS_CONTRACT_HEADING,
      'AGENTS.md is the top-level operating contract for the workspace.',
    ].join('\n');

    assert.equal(isOmxGeneratedAgentsMd(content), true);
    assert.equal(hasOmxAgentsContract(content), true);
  });

  it('does not treat title-only user AGENTS.md content as NOMX-generated', () => {
    const content = [
      '# NOMX - Intelligent Multi-Agent Orchestration',
      '',
      'User-authored guidance without any NOMX ownership markers.',
    ].join('\n');

    assert.equal(isOmxGeneratedAgentsMd(content), false);
    assert.equal(hasOmxManagedAgentsSections(content), false);
    assert.equal(hasOmxAgentsContract(content), false);
  });

  it('recognizes explicit NOMX-owned model table blocks as managed sections', () => {
    const content = [
      '# Shared ownership AGENTS',
      '',
      '<!-- NOMX:MODELS:START -->',
      'managed table',
      '<!-- NOMX:MODELS:END -->',
    ].join('\n');

    assert.equal(isOmxGeneratedAgentsMd(content), false);
    assert.equal(hasOmxManagedAgentsSections(content), true);
    assert.equal(hasOmxAgentsContract(content), false);
  });

  it('recognizes merged AGENTS blocks as carrying the NOMX contract only when the generated marker is inside', () => {
    const content = [
      '# Shared ownership AGENTS',
      '',
      NOMX_MANAGED_AGENTS_START_MARKER,
      '<!-- AUTONOMY DIRECTIVE — DO NOT REMOVE -->',
      '<!-- END AUTONOMY DIRECTIVE -->',
      NOMX_GENERATED_AGENTS_MARKER,
      NOMX_AGENTS_CONTRACT_HEADING,
      'AGENTS.md is the top-level operating contract for the workspace.',
      NOMX_MANAGED_AGENTS_END_MARKER,
    ].join('\n');

    assert.equal(isOmxGeneratedAgentsMd(content), true);
    assert.equal(hasOmxManagedAgentsSections(content), true);
    assert.equal(hasOmxAgentsContract(content), true);
  });

  it('does not accept a generated marker plus heading without the semantic contract text', () => {
    const content = [
      NOMX_GENERATED_AGENTS_MARKER,
      '# NOMX - Intelligent Multi-Agent Orchestration',
      'User-authored text that happens to reuse the title.',
    ].join('\n');

    assert.equal(hasOmxAgentsContract(content), false);
  });

  it('does not accept a managed AGENTS block that lacks the generated contract marker', () => {
    const content = [
      '# Shared ownership AGENTS',
      '',
      NOMX_MANAGED_AGENTS_START_MARKER,
      '# NOMX - Intelligent Multi-Agent Orchestration',
      'AGENTS.md is the top-level operating contract for the workspace.',
      NOMX_MANAGED_AGENTS_END_MARKER,
    ].join('\n');

    assert.equal(hasOmxAgentsContract(content), false);
  });

  it('extracts complete user-owned NOMX policy blocks', () => {
    const content = [
      '# Local policy',
      NOMX_USER_POLICY_START_MARKER,
      'Keep durable operator guidance.',
      NOMX_USER_POLICY_END_MARKER,
      'after',
    ].join('\n');

    assert.deepEqual(extractUserOmxPolicyBlocks(content), [
      [
        NOMX_USER_POLICY_START_MARKER,
        'Keep durable operator guidance.',
        NOMX_USER_POLICY_END_MARKER,
      ].join('\n'),
    ]);
  });

  it('appends missing user-owned NOMX policy blocks to regenerated content', () => {
    const existing = [
      '# Local policy',
      NOMX_USER_POLICY_START_MARKER,
      'Keep durable operator guidance.',
      NOMX_USER_POLICY_END_MARKER,
      '',
    ].join('\n');
    const regenerated = `${NOMX_GENERATED_AGENTS_MARKER}\n# New defaults\n`;

    const result = preserveUserOmxPolicyBlocks(existing, regenerated);

    assert.match(result, /# New defaults\n\n<!-- USER:NOMX:POLICY:START -->\nKeep durable operator guidance\.\n<!-- USER:NOMX:POLICY:END -->\n$/);
  });

  it('does not duplicate a user-owned NOMX policy block already present', () => {
    const policyBlock = [
      NOMX_USER_POLICY_START_MARKER,
      'Keep durable operator guidance.',
      NOMX_USER_POLICY_END_MARKER,
    ].join('\n');
    const existing = `# Local policy\n${policyBlock}\n`;
    const regenerated = `${NOMX_GENERATED_AGENTS_MARKER}\n${policyBlock}\n`;

    assert.equal(preserveUserOmxPolicyBlocks(existing, regenerated), regenerated);
  });
});
