import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setup } from '../setup.js';

async function recordManagedNativeAgent(
  codexDir: string,
  file: string,
  content: string,
): Promise<void> {
  const manifestPath = join(codexDir, '.nomx', 'native-agents.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    version: 1;
    files: Record<string, { sha256: string }>;
  };
  manifest.files[file] = {
    sha256: createHash('sha256').update(content).digest('hex'),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
import { readCatalogManifest } from '../../catalog/reader.js';
import {
  NON_NATIVE_AGENT_PROMPT_ASSETS,
  getInstallableNativeAgentNames,
} from '../../agents/policy.js';

const RETIRED_TEAM_EXECUTOR_PROMPT = readFileSync(
  join(process.cwd(), 'src', 'cli', '__tests__', 'fixtures', 'retired-prompts', 'team-executor.md'),
  'utf8',
);
const RETIRED_QA_TESTER_PROMPT = readFileSync(
  join(process.cwd(), 'src', 'cli', '__tests__', 'fixtures', 'retired-prompts', 'qa-tester.md'),
  'utf8',
);

describe('nomx setup prompt/native-agent overwrite behavior', () => {
  const obsoleteNativeAgentField = ['skill', 'ref'].join('_');

  it('installs setup-owned prompts separately from active/internal native agents', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'nomx-setup-prompts-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(wd);

      await setup({ scope: 'project' });

      const promptsDir = join(wd, '.codex', 'prompts');
      const nativeAgentsDir = join(wd, '.codex', 'agents');
      const installedPrompts = new Set(await readdir(promptsDir));
      const installedNativeAgents = new Set(await readdir(nativeAgentsDir));

      assert.equal(installedPrompts.has('executor.md'), true);
      assert.equal(installedPrompts.has('team-executor.md'), false);
      assert.equal(installedPrompts.has('code-reviewer.md'), true);
      assert.equal(installedPrompts.has('code-simplifier.md'), true);

      for (const promptOnlyAgent of [
        'style-reviewer',
        'quality-reviewer',
        'api-reviewer',
        'performance-reviewer',
        'product-manager',
        'ux-researcher',
        'information-architect',
        'product-analyst',
        'quality-strategist',
      ]) {
        assert.equal(
          installedPrompts.has(`${promptOnlyAgent}.md`),
          true,
          `expected setup to preserve prompt-only role ${promptOnlyAgent}.md`,
        );
      }

      for (const promptAsset of NON_NATIVE_AGENT_PROMPT_ASSETS) {
        assert.equal(
          installedPrompts.has(`${promptAsset}.md`),
          true,
          `expected setup to preserve explicit prompt asset ${promptAsset}.md`,
        );
      }

      const installableNativeAgents = getInstallableNativeAgentNames(readCatalogManifest());
      for (const agentName of installableNativeAgents) {
        assert.equal(
          installedNativeAgents.has(`${agentName}.toml`),
          true,
          `expected setup to install native agent ${agentName}.toml`,
        );
      }
      assert.equal(installedNativeAgents.has('code-review.toml'), false);
      assert.equal(installedNativeAgents.has('plan.toml'), false);
      assert.equal(installedNativeAgents.has('style-reviewer.toml'), false);
      assert.equal(installedNativeAgents.has('quality-reviewer.toml'), false);
      assert.equal(installedNativeAgents.has('api-reviewer.toml'), false);
      assert.equal(installedNativeAgents.has('performance-reviewer.toml'), false);
      assert.equal(installedNativeAgents.has('product-manager.toml'), false);
      assert.equal(installedNativeAgents.has('ux-researcher.toml'), false);
      assert.equal(installedNativeAgents.has('information-architect.toml'), false);
      assert.equal(installedNativeAgents.has('product-analyst.toml'), false);

      const codeReviewerToml = await readFile(join(wd, '.codex', 'agents', 'code-reviewer.toml'), 'utf-8');
      assert.match(codeReviewerToml, /^name = "code-reviewer"$/m);
      assert.match(codeReviewerToml, /developer_instructions\s*=/);
    } finally {
      process.chdir(previousCwd);
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('ordinary refresh removes retired NOMX prompt and native-agent files while preserving unrelated TOMLs', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'nomx-setup-prompts-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(wd);
      await setup({ scope: 'project' });

      const promptsDir = join(wd, '.codex', 'prompts');
      const agentsDir = join(wd, '.codex', 'agents');
      await writeFile(join(promptsDir, 'team-executor.md'), RETIRED_TEAM_EXECUTOR_PROMPT);
      await writeFile(join(promptsDir, 'qa-tester.md'), RETIRED_QA_TESTER_PROMPT);
      const retiredAgentContent = '# nomx agent: team-executor\nname = "team-executor"\n';
      await writeFile(join(agentsDir, 'team-executor.toml'), retiredAgentContent);
      await recordManagedNativeAgent(join(wd, '.codex'), 'team-executor.toml', retiredAgentContent);
      const customAgentPath = join(agentsDir, 'my-custom-agent.toml');
      await writeFile(customAgentPath, 'name = "my-custom-agent"\n');

      await setup({ scope: 'project' });

      assert.equal(existsSync(join(promptsDir, 'team-executor.md')), false);
      assert.equal(existsSync(join(promptsDir, 'qa-tester.md')), false);
      assert.equal(existsSync(join(agentsDir, 'team-executor.toml')), false);
      assert.equal(await readFile(customAgentPath, 'utf8'), 'name = "my-custom-agent"\n');
    } finally {
      process.chdir(previousCwd);
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('preserves unmarked user prompts that reuse retired NOMX prompt names, including on force', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'nomx-setup-prompts-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(wd);
      await setup({ scope: 'project' });

      const promptsDir = join(wd, '.codex', 'prompts');
      const customPrompts = new Map([
        ['team-executor.md', `${RETIRED_TEAM_EXECUTOR_PROMPT}# local customization\n`],
        ['qa-tester.md', `${RETIRED_QA_TESTER_PROMPT}# local customization\n`],
      ]);
      for (const [file, content] of customPrompts) {
        await writeFile(join(promptsDir, file), content);
      }

      await setup({ scope: 'project' });
      await setup({ scope: 'project', force: true });

      for (const [file, content] of customPrompts) {
        assert.equal(await readFile(join(promptsDir, file), 'utf8'), content);
      }
    } finally {
      process.chdir(previousCwd);
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('preserves an unmanaged native agent that reuses a retired NOMX agent name', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'nomx-setup-prompts-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(wd);
      await setup({ scope: 'project' });

      const retiredAgentPath = join(wd, '.codex', 'agents', 'team-executor.toml');
      const customAgent = '# nomx agent: team-executor\nname = "team-executor"\ndeveloper_instructions = "local"\n';
      await writeFile(retiredAgentPath, customAgent);

      await setup({ scope: 'project' });
      await setup({ scope: 'project', force: true });

      assert.equal(await readFile(retiredAgentPath, 'utf8'), customAgent);
    } finally {
      process.chdir(previousCwd);
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('preserves user-customized installable native agent TOMLs during normal setup refresh', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'nomx-setup-prompts-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(wd);

      await setup({ scope: 'project' });

      const executorPath = join(wd, '.codex', 'agents', 'executor.toml');
      const installed = await readFile(executorPath, 'utf-8');
      const customized = installed
        .replace(/^model = ".*"$/m, 'model = "gpt-5.5"')
        .replace(/^model_reasoning_effort = ".*"$/m, 'model_reasoning_effort = "low"');
      assert.notEqual(customized, installed);
      await writeFile(executorPath, customized);

      await setup({ scope: 'project' });

      assert.equal(await readFile(executorPath, 'utf-8'), customized);
    } finally {
      process.chdir(previousCwd);
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('overwrites customized native agent TOMLs only when setup force is explicit', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'nomx-setup-prompts-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(wd);

      await setup({ scope: 'project' });

      const executorPath = join(wd, '.codex', 'agents', 'executor.toml');
      const installed = await readFile(executorPath, 'utf-8');
      const customized = installed
        .replace(/^model = ".*"$/m, 'model = "gpt-5.5"')
        .replace(/^model_reasoning_effort = ".*"$/m, 'model_reasoning_effort = "low"');
      await writeFile(executorPath, customized);

      await setup({ scope: 'project', force: true });

      const refreshed = await readFile(executorPath, 'utf-8');
      assert.notEqual(refreshed, customized);
      assert.match(refreshed, /^# nomx agent: executor$/m);
      assert.doesNotMatch(refreshed, /^model = "gpt-5\.4"$/m);
      assert.doesNotMatch(refreshed, /^model_reasoning_effort = "low"$/m);
    } finally {
      process.chdir(previousCwd);
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('preserves current native agents but removes retired generated agents during background update-check refreshes', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'nomx-setup-prompts-'));
    const previousCwd = process.cwd();
    const previousSkipNativeAgentRefresh = process.env.NOMX_SKIP_NATIVE_AGENT_REFRESH;
    try {
      process.chdir(wd);

      await setup({ scope: 'project' });

      const executorPath = join(wd, '.codex', 'agents', 'executor.toml');
      const installed = await readFile(executorPath, 'utf-8');
      const customized = installed
        .replace(/^model = ".*"$/m, 'model = "gpt-5.5"')
        .replace(/^model_reasoning_effort = ".*"$/m, 'model_reasoning_effort = "low"');
      await writeFile(executorPath, customized);
      const retiredAgentPath = join(wd, '.codex', 'agents', 'team-executor.toml');
      const retiredAgentContent = '# nomx agent: team-executor\nname = "team-executor"\n';
      await writeFile(retiredAgentPath, retiredAgentContent);
      await recordManagedNativeAgent(join(wd, '.codex'), 'team-executor.toml', retiredAgentContent);

      process.env.NOMX_SKIP_NATIVE_AGENT_REFRESH = '1';
      await setup({ scope: 'project' });

      assert.equal(await readFile(executorPath, 'utf-8'), customized);
      assert.equal(existsSync(retiredAgentPath), false);
    } finally {
      if (typeof previousSkipNativeAgentRefresh === 'string') process.env.NOMX_SKIP_NATIVE_AGENT_REFRESH = previousSkipNativeAgentRefresh;
      else delete process.env.NOMX_SKIP_NATIVE_AGENT_REFRESH;
      process.chdir(previousCwd);
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('preserves setup-owned prompt assets and unmarked user prompts on --force', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'nomx-setup-prompts-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(wd);

      await setup({ scope: 'project' });

      const validPrompts = ['style-reviewer.md', 'quality-reviewer.md', 'sisyphus-lite.md'];
      for (const validPrompt of validPrompts) {
        assert.equal(existsSync(join(wd, '.codex', 'prompts', validPrompt)), true);
      }

      const unknownPromptPath = join(wd, '.codex', 'prompts', 'unclassified-local.md');
      await writeFile(unknownPromptPath, '# unclassified local prompt\n');
      assert.equal(existsSync(unknownPromptPath), true);

      await setup({ scope: 'project', force: true });

      for (const validPrompt of validPrompts) {
        assert.equal(existsSync(join(wd, '.codex', 'prompts', validPrompt)), true);
      }
      assert.equal(await readFile(unknownPromptPath, 'utf8'), '# unclassified local prompt\n');
      assert.equal(existsSync(join(wd, '.codex', 'prompts', 'executor.md')), true);
    } finally {
      process.chdir(previousCwd);
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('removes stale merged native agents on --force', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'nomx-setup-prompts-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(wd);

      await setup({ scope: 'project' });

      const staleAgents = ['style-reviewer.toml', 'quality-reviewer.toml'];
      for (const staleAgent of staleAgents) {
        const stalePath = join(wd, '.codex', 'agents', staleAgent);
        const staleContent = '# stale native agent\n';
        await writeFile(stalePath, staleContent);
        await recordManagedNativeAgent(join(wd, '.codex'), staleAgent, staleContent);
        assert.equal(existsSync(stalePath), true);
      }

      await setup({ scope: 'project', force: true });

      for (const staleAgent of staleAgents) {
        assert.equal(existsSync(join(wd, '.codex', 'agents', staleAgent)), false);
      }
      assert.equal(existsSync(join(wd, '.codex', 'agents', 'executor.toml')), true);
    } finally {
      process.chdir(previousCwd);
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('removes generated non-installable native agents during normal setup', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'nomx-setup-prompts-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(wd);

      await setup({ scope: 'project' });

      const stalePath = join(wd, '.codex', 'agents', 'style-reviewer.toml');
      const staleContent = [
          '# nomx agent: style-reviewer',
          'name = "style-reviewer"',
          'description = "old generated merged role"',
          'developer_instructions = """old"""',
          '',
        ].join('\n');
      await writeFile(stalePath, staleContent);
      await recordManagedNativeAgent(join(wd, '.codex'), 'style-reviewer.toml', staleContent);
      assert.equal(existsSync(stalePath), true);

      await setup({ scope: 'project' });

      assert.equal(existsSync(stalePath), false);
      assert.equal(existsSync(join(wd, '.codex', 'agents', 'executor.toml')), true);
    } finally {
      process.chdir(previousCwd);
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('preserves user-authored non-installable native agents during normal setup', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'nomx-setup-prompts-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(wd);

      await setup({ scope: 'project' });

      const userAuthoredPath = join(wd, '.codex', 'agents', 'style-reviewer.toml');
      await writeFile(
        userAuthoredPath,
        [
          '# user-authored local agent',
          'name = "style-reviewer"',
          'description = "custom local role"',
          '',
        ].join('\n'),
      );
      assert.equal(existsSync(userAuthoredPath), true);

      await setup({ scope: 'project' });

      assert.equal(existsSync(userAuthoredPath), true);
      assert.equal(existsSync(join(wd, '.codex', 'agents', 'executor.toml')), true);
    } finally {
      process.chdir(previousCwd);
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('removes stale native agents with the obsolete bridge field during normal setup', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'nomx-setup-prompts-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(wd);

      await setup({ scope: 'project' });

      const stalePath = join(wd, '.codex', 'agents', 'legacy-skill-agent.toml');
      await writeFile(
        stalePath,
        [
          'name = "legacy-skill-agent"',
          'description = "obsolete generated bridge agent"',
          `${obsoleteNativeAgentField} = "skills/legacy"`,
          '',
        ].join('\n'),
      );
      assert.equal(existsSync(stalePath), true);

      await setup({ scope: 'project' });

      assert.equal(existsSync(stalePath), false);
      assert.equal(existsSync(join(wd, '.codex', 'agents', 'executor.toml')), true);
    } finally {
      process.chdir(previousCwd);
      await rm(wd, { recursive: true, force: true });
    }
  });
});
