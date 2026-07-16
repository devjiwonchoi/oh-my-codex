import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setup } from '../setup.js';

const CORE_SKILLS = [
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
] as const;

async function withProjectSetup(
  run: (cwd: string) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'nomx-setup-skills-'));
  const previousCwd = process.cwd();
  try {
    process.chdir(cwd);
    await setup({ scope: 'project' });
    await run(cwd);
  } finally {
    process.chdir(previousCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

describe('nomx setup skills overwrite behavior', () => {
  it('installs exactly the supported core skill catalog', async () => {
    await withProjectSetup(async (cwd) => {
      const installed = (await readdir(join(cwd, '.codex', 'skills'))).sort();
      assert.deepEqual(installed, [...CORE_SKILLS].sort());
      for (const skill of CORE_SKILLS) {
        const content = await readFile(join(cwd, '.codex', 'skills', skill, 'SKILL.md'), 'utf8');
        assert.match(content, /description:\s*["']?\[NOMX\]/);
      }
    });
  });

  it('refreshes managed skill files and backs up local changes', async () => {
    await withProjectSetup(async (cwd) => {
      const skillPath = join(cwd, '.codex', 'skills', 'doctor', 'SKILL.md');
      const installed = await readFile(skillPath, 'utf8');
      await writeFile(skillPath, `${installed}\n# local customization\n`);

      await setup({ scope: 'project' });

      assert.equal(await readFile(skillPath, 'utf8'), installed);
      assert.equal(existsSync(join(cwd, '.nomx', 'backups', 'setup')), true);
    });
  });

  it('preserves unrelated user-authored skill directories', async () => {
    await withProjectSetup(async (cwd) => {
      const customPath = join(cwd, '.codex', 'skills', 'my-custom-skill', 'SKILL.md');
      await mkdir(join(cwd, '.codex', 'skills', 'my-custom-skill'), { recursive: true });
      await writeFile(customPath, '---\nname: my-custom-skill\ndescription: local custom skill\n---\n');

      await setup({ scope: 'project', force: true });

      assert.equal(
        await readFile(customPath, 'utf8'),
        '---\nname: my-custom-skill\ndescription: local custom skill\n---\n',
      );
    });
  });

  it('preserves unmanaged skills that reuse a retired NOMX skill name', async () => {
    await withProjectSetup(async (cwd) => {
      const skillPath = join(cwd, '.codex', 'skills', 'team', 'SKILL.md');
      const customSkill = '---\nname: team\ndescription: "[NOMX] local user skill"\n---\n';
      await mkdir(join(cwd, '.codex', 'skills', 'team'), { recursive: true });
      await writeFile(skillPath, customSkill);

      await setup({ scope: 'project' });
      await setup({ scope: 'project', force: true });

      assert.equal(await readFile(skillPath, 'utf8'), customSkill);
    });
  });

  it('preserves a user-authored skill directory with additional assets', async () => {
    await withProjectSetup(async (cwd) => {
      const skillDir = join(cwd, '.codex', 'skills', 'team');
      const skillPath = join(skillDir, 'SKILL.md');
      const customSkill = '---\nname: team\ndescription: local user skill\n---\n';
      await mkdir(skillDir, { recursive: true });
      await writeFile(skillPath, customSkill);
      await writeFile(join(skillDir, 'notes.md'), 'user-owned notes\n');

      await setup({ scope: 'project', force: true });

      assert.equal(await readFile(skillPath, 'utf8'), customSkill);
      assert.equal(await readFile(join(skillDir, 'notes.md'), 'utf8'), 'user-owned notes\n');
    });
  });

  it('does not stack the NOMX description badge on repeated setup runs', async () => {
    await withProjectSetup(async (cwd) => {
      await setup({ scope: 'project' });
      const content = await readFile(join(cwd, '.codex', 'skills', 'doctor', 'SKILL.md'), 'utf8');
      assert.equal((content.match(/\[NOMX\]/g) ?? []).length, 1);
      assert.doesNotMatch(content, /\[NOMX\]\s+\[NOMX\]/);
    });
  });
});
