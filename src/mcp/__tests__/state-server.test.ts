import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('state-server directory initialization', () => {
  it('keeps read-only state tools side-effect-free without setup', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-test-'));
    try {
      const stateDir = join(wd, '.nomx', 'state');
      const tmuxHookConfig = join(wd, '.nomx', 'tmux-hook.json');
      assert.equal(existsSync(stateDir), false);
      assert.equal(existsSync(tmuxHookConfig), false);

      const response = await handleStateToolCall({
        params: {
          name: 'state_list_active',
          arguments: { workingDirectory: wd },
        },
      });

      assert.equal(existsSync(stateDir), false);
      assert.equal(existsSync(tmuxHookConfig), false);
      assert.deepEqual(
        JSON.parse(response.content[0]?.text || '{}'),
        { active_modes: [] },
      );
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('creates boxed runtime state under NOMX_ROOT for mutating tools', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const previousOmxRoot = process.env.NOMX_ROOT;
    const { handleStateToolCall } = await import('../state-server.js');

    const root = await mkdtemp(join(tmpdir(), 'nomx-state-server-boxed-'));
    const box = join(root, 'box');
    const wd = join(root, 'source');
    try {
      await mkdir(wd, { recursive: true });
      process.env.NOMX_ROOT = box;

      const response = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            mode: 'ralph',
            active: true,
            iteration: 1,
            current_phase: 'executing',
          },
        },
      });

      assert.equal(response.isError, undefined);
      assert.equal(existsSync(join(box, '.nomx', 'state', 'ralph-state.json')), true);
      assert.equal(existsSync(join(box, '.nomx', 'tmux-hook.json')), false);
      assert.equal(existsSync(join(wd, '.nomx', 'state')), false);
      assert.equal(existsSync(join(wd, '.nomx', 'tmux-hook.json')), false);
    } finally {
      if (typeof previousOmxRoot === 'string') process.env.NOMX_ROOT = previousOmxRoot;
      else delete process.env.NOMX_ROOT;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('co-locates boxed tracked mode and canonical skill state under NOMX_ROOT', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const previousOmxRoot = process.env.NOMX_ROOT;
    const previousOmxStateRoot = process.env.NOMX_STATE_ROOT;
    const previousTeamStateRoot = process.env.NOMX_TEAM_STATE_ROOT;
    const { handleStateToolCall } = await import('../state-server.js');

    const root = await mkdtemp(join(tmpdir(), 'nomx-state-server-boxed-skill-'));
    const box = join(root, 'box');
    const wd = join(root, 'source');
    const sessionId = 'sess-boxed-ralplan';
    try {
      await mkdir(wd, { recursive: true });
      process.env.NOMX_ROOT = box;
      delete process.env.NOMX_STATE_ROOT;
      delete process.env.NOMX_TEAM_STATE_ROOT;

      const response = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: sessionId,
            mode: 'ralplan',
            active: true,
            current_phase: 'planning',
          },
        },
      });

      assert.equal(response.isError, undefined);
      const boxedSessionDir = join(box, '.nomx', 'state', 'sessions', sessionId);
      assert.equal(existsSync(join(boxedSessionDir, 'ralplan-state.json')), true);
      assert.equal(existsSync(join(boxedSessionDir, 'skill-active-state.json')), true);
      assert.equal(existsSync(join(wd, '.nomx', 'state', 'sessions', sessionId, 'ralplan-state.json')), false);
      assert.equal(existsSync(join(wd, '.nomx', 'state', 'sessions', sessionId, 'skill-active-state.json')), false);
    } finally {
      if (typeof previousOmxRoot === 'string') process.env.NOMX_ROOT = previousOmxRoot;
      else delete process.env.NOMX_ROOT;
      if (typeof previousOmxStateRoot === 'string') process.env.NOMX_STATE_ROOT = previousOmxStateRoot;
      else delete process.env.NOMX_STATE_ROOT;
      if (typeof previousTeamStateRoot === 'string') process.env.NOMX_TEAM_STATE_ROOT = previousTeamStateRoot;
      else delete process.env.NOMX_TEAM_STATE_ROOT;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('co-locates tracked mode and canonical skill state under NOMX_TEAM_STATE_ROOT', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const previousOmxRoot = process.env.NOMX_ROOT;
    const previousOmxStateRoot = process.env.NOMX_STATE_ROOT;
    const previousTeamStateRoot = process.env.NOMX_TEAM_STATE_ROOT;
    const { handleStateToolCall } = await import('../state-server.js');

    const root = await mkdtemp(join(tmpdir(), 'nomx-state-server-team-skill-'));
    const teamStateRoot = join(root, 'team-state');
    const wd = join(root, 'source');
    const sessionId = 'sess-team-ralplan';
    try {
      await mkdir(wd, { recursive: true });
      delete process.env.NOMX_ROOT;
      delete process.env.NOMX_STATE_ROOT;
      process.env.NOMX_TEAM_STATE_ROOT = teamStateRoot;

      const response = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: sessionId,
            mode: 'ralplan',
            active: true,
            current_phase: 'planning',
          },
        },
      });

      assert.equal(response.isError, undefined);
      const teamSessionDir = join(teamStateRoot, 'sessions', sessionId);
      assert.equal(existsSync(join(teamSessionDir, 'ralplan-state.json')), true);
      assert.equal(existsSync(join(teamSessionDir, 'skill-active-state.json')), true);
      assert.equal(existsSync(join(wd, '.nomx', 'state', 'sessions', sessionId, 'ralplan-state.json')), false);
      assert.equal(existsSync(join(wd, '.nomx', 'state', 'sessions', sessionId, 'skill-active-state.json')), false);
    } finally {
      if (typeof previousOmxRoot === 'string') process.env.NOMX_ROOT = previousOmxRoot;
      else delete process.env.NOMX_ROOT;
      if (typeof previousOmxStateRoot === 'string') process.env.NOMX_STATE_ROOT = previousOmxStateRoot;
      else delete process.env.NOMX_STATE_ROOT;
      if (typeof previousTeamStateRoot === 'string') process.env.NOMX_TEAM_STATE_ROOT = previousTeamStateRoot;
      else delete process.env.NOMX_TEAM_STATE_ROOT;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps auto-completed transition canonical state under NOMX_TEAM_STATE_ROOT', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const previousOmxRoot = process.env.NOMX_ROOT;
    const previousOmxStateRoot = process.env.NOMX_STATE_ROOT;
    const previousTeamStateRoot = process.env.NOMX_TEAM_STATE_ROOT;
    const { handleStateToolCall } = await import('../state-server.js');

    const root = await mkdtemp(join(tmpdir(), 'nomx-state-server-team-transition-'));
    const teamStateRoot = join(root, 'team-state');
    const wd = join(root, 'source');
    const sessionId = 'sess-team-transition';
    try {
      await mkdir(wd, { recursive: true });
      delete process.env.NOMX_ROOT;
      delete process.env.NOMX_STATE_ROOT;
      process.env.NOMX_TEAM_STATE_ROOT = teamStateRoot;

      const deepInterview = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: sessionId,
            mode: 'deep-interview',
            active: true,
            current_phase: 'interviewing',
            deep_interview_gate: {
              status: 'complete',
              rationale: 'Requirements are clarified and ready for ralplan consensus.',
            },
          },
        },
      });
      assert.equal(deepInterview.isError, undefined);

      const ralplan = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: sessionId,
            mode: 'ralplan',
            active: true,
            current_phase: 'planning',
          },
        },
      });

      assert.equal(ralplan.isError, undefined);
      const teamSessionDir = join(teamStateRoot, 'sessions', sessionId);
      const completedDeepInterview = JSON.parse(
        await readFile(join(teamSessionDir, 'deep-interview-state.json'), 'utf-8'),
      ) as { active?: boolean; current_phase?: string };
      assert.equal(completedDeepInterview.active, false);
      assert.equal(completedDeepInterview.current_phase, 'completed');
      assert.equal(existsSync(join(teamSessionDir, 'ralplan-state.json')), true);
      assert.equal(existsSync(join(teamSessionDir, 'skill-active-state.json')), true);
      assert.equal(existsSync(join(wd, '.nomx', 'state', 'sessions', sessionId, 'deep-interview-state.json')), false);
      assert.equal(existsSync(join(wd, '.nomx', 'state', 'sessions', sessionId, 'skill-active-state.json')), false);
    } finally {
      if (typeof previousOmxRoot === 'string') process.env.NOMX_ROOT = previousOmxRoot;
      else delete process.env.NOMX_ROOT;
      if (typeof previousOmxStateRoot === 'string') process.env.NOMX_STATE_ROOT = previousOmxStateRoot;
      else delete process.env.NOMX_STATE_ROOT;
      if (typeof previousTeamStateRoot === 'string') process.env.NOMX_TEAM_STATE_ROOT = previousTeamStateRoot;
      else delete process.env.NOMX_TEAM_STATE_ROOT;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps missing state_read side-effect-free without setup', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-read-test-'));
    try {
      const stateDir = join(wd, '.nomx', 'state');
      const tmuxHookConfig = join(wd, '.nomx', 'tmux-hook.json');
      assert.equal(existsSync(stateDir), false);
      assert.equal(existsSync(tmuxHookConfig), false);

      const response = await handleStateToolCall({
        params: {
          name: 'state_read',
          arguments: { workingDirectory: wd, mode: 'deep-interview' },
        },
      });

      assert.equal(existsSync(stateDir), false);
      assert.equal(existsSync(tmuxHookConfig), false);
      assert.deepEqual(
        JSON.parse(response.content[0]?.text || '{}'),
        { exists: false, mode: 'deep-interview' },
      );
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('keeps state_get_status side-effect-free without setup', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-status-test-'));
    try {
      const stateDir = join(wd, '.nomx', 'state');
      const tmuxHookConfig = join(wd, '.nomx', 'tmux-hook.json');
      assert.equal(existsSync(stateDir), false);
      assert.equal(existsSync(tmuxHookConfig), false);

      const response = await handleStateToolCall({
        params: {
          name: 'state_get_status',
          arguments: { workingDirectory: wd },
        },
      });

      assert.equal(existsSync(stateDir), false);
      assert.equal(existsSync(tmuxHookConfig), false);
      assert.deepEqual(
        JSON.parse(response.content[0]?.text || '{}'),
        { statuses: {} },
      );
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('writes and reads deep-interview state', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-test-'));
    try {
      const writeResponse = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            mode: 'deep-interview',
            active: true,
            current_phase: 'deep-interview',
            state: {
              current_focus: 'intent',
              threshold: 0.2,
            },
          },
        },
      });

      assert.equal(writeResponse.isError, undefined);
      assert.deepEqual(
        JSON.parse(writeResponse.content[0]?.text || '{}'),
        {
          success: true,
          mode: 'deep-interview',
          path: join(wd, '.nomx', 'state', 'deep-interview-state.json'),
        },
      );

      const readResponse = await handleStateToolCall({
        params: {
          name: 'state_read',
          arguments: {
            workingDirectory: wd,
            mode: 'deep-interview',
          },
        },
      });

      assert.equal(readResponse.isError, undefined);
      const readBody = JSON.parse(readResponse.content[0]?.text || '{}') as Record<string, unknown>;
      assert.equal(readBody.active, true);
      assert.equal(readBody.current_phase, 'deep-interview');
      assert.equal(readBody.current_focus, 'intent');
      assert.equal(readBody.threshold, 0.2);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('accepts canonical lifecycle_outcome and backfills compatibility run_outcome', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-lifecycle-'));
    try {
      const writeResponse = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            mode: 'deep-interview',
            active: false,
            lifecycle_outcome: 'askuserQuestion',
            state: {
              current_focus: 'intent',
            },
          },
        },
      });

      assert.equal(writeResponse.isError, undefined);

      const readResponse = await handleStateToolCall({
        params: {
          name: 'state_read',
          arguments: {
            workingDirectory: wd,
            mode: 'deep-interview',
          },
        },
      });

      const readBody = JSON.parse(readResponse.content[0]?.text || '{}') as Record<string, unknown>;
      assert.equal(readBody.lifecycle_outcome, 'askuserQuestion');
      assert.equal(readBody.run_outcome, 'blocked_on_user');
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('derives canonical lifecycle_outcome from legacy run_outcome when needed', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-run-outcome-'));
    try {
      await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            mode: 'ultrawork',
            active: false,
            run_outcome: 'cancelled',
          },
        },
      });

      const readResponse = await handleStateToolCall({
        params: {
          name: 'state_read',
          arguments: {
            workingDirectory: wd,
            mode: 'ultrawork',
          },
        },
      });

      const readBody = JSON.parse(readResponse.content[0]?.text || '{}') as Record<string, unknown>;
      assert.equal(readBody.lifecycle_outcome, 'userinterlude');
      assert.equal(readBody.run_outcome, 'cancelled');
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('keeps session-scoped state_get_status side-effect-free when session_id is provided', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-test-'));
    try {
      const stateDir = join(wd, '.nomx', 'state');
      const sessionDir = join(wd, '.nomx', 'state', 'sessions', 'sess1');
      const tmuxHookConfig = join(wd, '.nomx', 'tmux-hook.json');
      assert.equal(existsSync(stateDir), false);
      assert.equal(existsSync(sessionDir), false);
      assert.equal(existsSync(tmuxHookConfig), false);

      const response = await handleStateToolCall({
        params: {
          name: 'state_get_status',
          arguments: { workingDirectory: wd, session_id: 'sess1' },
        },
      });

      assert.equal(existsSync(stateDir), false);
      assert.equal(existsSync(sessionDir), false);
      assert.equal(existsSync(tmuxHookConfig), false);
      assert.deepEqual(
        JSON.parse(response.content[0]?.text || '{}'),
        { statuses: {} },
      );
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('state_write accepts canonical lifecycle_outcome while preserving compatibility run_outcome', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-lifecycle-'));
    try {
      const response = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            mode: 'autopilot',
            active: false,
            current_phase: 'waiting-for-user-answer',
            lifecycle_outcome: 'askuserQuestion',
          },
        },
      });

      assert.equal(response.isError, undefined);
      const state = JSON.parse(await readFile(join(wd, '.nomx', 'state', 'autopilot-state.json'), 'utf-8')) as {
        active?: boolean;
        lifecycle_outcome?: string;
        terminal_outcome?: string;
        run_outcome?: string;
        completed_at?: string;
      };
      assert.equal(state.active, false);
      assert.equal(state.lifecycle_outcome, 'askuserQuestion');
      assert.equal(state.terminal_outcome, undefined);
      assert.equal(state.run_outcome, 'blocked_on_user');
      assert.ok(state.completed_at);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('state_write lets canonical lifecycle_outcome take precedence over legacy run_outcome', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-lifecycle-precedence-'));
    try {
      const response = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            mode: 'autopilot',
            active: false,
            current_phase: 'user-stopped',
            run_outcome: 'failed',
            lifecycle_outcome: 'userinterlude',
          },
        },
      });

      assert.equal(response.isError, undefined);
      const state = JSON.parse(await readFile(join(wd, '.nomx', 'state', 'autopilot-state.json'), 'utf-8')) as {
        lifecycle_outcome?: string;
        run_outcome?: string;
      };
      assert.equal(state.lifecycle_outcome, 'userinterlude');
      assert.equal(state.run_outcome, 'cancelled');
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('serializes concurrent state_write calls per mode file and preserves merged fields', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-test-'));
    try {
      const writes = Array.from({ length: 16 }, (_, i) => handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            mode: 'scratch',
            state: { [`k${i}`]: i },
          },
        },
      }));

      const responses = await Promise.all(writes);
      for (const response of responses) {
        assert.equal(response.isError, undefined);
      }

      const filePath = join(wd, '.nomx', 'state', 'scratch-state.json');
      const state = JSON.parse(await readFile(filePath, 'utf-8')) as Record<string, unknown>;
      for (let i = 0; i < 16; i++) {
        assert.equal(state[`k${i}`], i);
      }
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('syncs canonical skill-active state for tracked mode writes and clears', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-canonical-'));
    try {
      await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-sync',
            mode: 'ralph',
            active: true,
            iteration: 1,
            max_iterations: 3,
            current_phase: 'executing',
          },
        },
      });

      const canonicalPath = join(wd, '.nomx', 'state', 'sessions', 'sess-sync', 'skill-active-state.json');
      const canonical = JSON.parse(await readFile(canonicalPath, 'utf-8')) as {
        active_skills?: Array<{ skill: string; session_id?: string; activated_at?: string; updated_at?: string }>;
      };
      assert.deepEqual(canonical.active_skills, [{
        skill: 'ralph',
        phase: 'executing',
        active: true,
        activated_at: canonical.active_skills?.[0]?.activated_at,
        updated_at: canonical.active_skills?.[0]?.updated_at,
        session_id: 'sess-sync',
      }]);

      await handleStateToolCall({
        params: {
          name: 'state_clear',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-sync',
            mode: 'ralph',
          },
        },
      });

      const clearedCanonical = JSON.parse(await readFile(canonicalPath, 'utf-8')) as {
        active: boolean;
        active_skills?: unknown[];
      };
      assert.equal(clearedCanonical.active, false);
      assert.deepEqual(clearedCanonical.active_skills, []);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('writes a session-scoped inactive tombstone when clearing a mode under an active session', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-clear-root-fallback-'));
    try {
      const stateDir = join(wd, '.nomx', 'state');
      const sessionId = 'sess-clear';
      const sessionDir = join(stateDir, 'sessions', sessionId);
      await mkdir(sessionDir, { recursive: true });
      await writeFile(join(stateDir, 'session.json'), JSON.stringify({ session_id: sessionId }, null, 2));
      await writeFile(
        join(stateDir, 'deep-interview-state.json'),
        JSON.stringify({ active: true, mode: 'deep-interview', current_phase: 'legacy-root' }, null, 2),
      );
      await writeFile(
        join(sessionDir, 'deep-interview-state.json'),
        JSON.stringify({ active: true, mode: 'deep-interview', current_phase: 'session-active' }, null, 2),
      );

      await handleStateToolCall({
        params: {
          name: 'state_clear',
          arguments: {
            workingDirectory: wd,
            mode: 'deep-interview',
          },
        },
      });

      const sessionState = JSON.parse(
        await readFile(join(sessionDir, 'deep-interview-state.json'), 'utf-8'),
      ) as Record<string, unknown>;
      assert.equal(sessionState.active, false);
      assert.equal(sessionState.current_phase, 'cleared');
      assert.equal(sessionState.session_id, sessionId);

      const listResponse = await handleStateToolCall({
        params: {
          name: 'state_list_active',
          arguments: {
            workingDirectory: wd,
          },
        },
      });
      assert.deepEqual(JSON.parse(listResponse.content[0]?.text || '{}'), { active_modes: [] });

      const readResponse = await handleStateToolCall({
        params: {
          name: 'state_read',
          arguments: {
            workingDirectory: wd,
            mode: 'deep-interview',
          },
        },
      });
      const readBody = JSON.parse(readResponse.content[0]?.text || '{}') as Record<string, unknown>;
      assert.equal(readBody.active, false);
      assert.equal(readBody.current_phase, 'cleared');
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('preserves supported canonical state when clearing historical Team state', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-overlap-'));
    try {
      const sessionDir = join(wd, '.nomx', 'state', 'sessions', 'sess-overlap');
      await mkdir(sessionDir, { recursive: true });
      await writeFile(join(sessionDir, 'team-state.json'), JSON.stringify({
        mode: 'team',
        active: true,
        current_phase: 'running',
        session_id: 'sess-overlap',
      }, null, 2));
      await writeFile(join(sessionDir, 'run-state.json'), JSON.stringify({
        mode: 'team',
        active: true,
        current_phase: 'running',
        session_id: 'sess-overlap',
      }, null, 2));
      await writeFile(join(sessionDir, 'skill-active-state.json'), JSON.stringify({
        version: 1,
        active: true,
        skill: 'team',
        phase: 'running',
        session_id: 'sess-overlap',
        active_skills: [{
          skill: 'team',
          phase: 'running',
          active: true,
          session_id: 'sess-overlap',
        }],
      }, null, 2));

      const ralphWrite = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-overlap',
            mode: 'ralph',
            active: true,
            iteration: 1,
            max_iterations: 3,
            current_phase: 'executing',
          },
        },
      });
      assert.equal(ralphWrite.isError, undefined);

      const canonicalPath = join(wd, '.nomx', 'state', 'sessions', 'sess-overlap', 'skill-active-state.json');
      const canonical = JSON.parse(await readFile(canonicalPath, 'utf-8')) as {
        active_skills?: Array<{ skill: string }>;
      };
      assert.deepEqual(canonical.active_skills?.map((entry) => entry.skill), ['team', 'ralph']);

      await handleStateToolCall({
        params: {
          name: 'state_clear',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-overlap',
            mode: 'team',
          },
        },
      });

      const clearedCanonical = JSON.parse(await readFile(canonicalPath, 'utf-8')) as {
        active: boolean;
        skill: string;
        active_skills?: Array<{ skill: string }>;
      };
      assert.equal(clearedCanonical.active, true);
      assert.equal(clearedCanonical.skill, 'ralph');
      assert.deepEqual(clearedCanonical.active_skills?.map((entry) => entry.skill), ['ralph']);
      assert.equal(existsSync(join(sessionDir, 'run-state.json')), false);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('rejects retired Team writes without mutating a supported workflow', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-deny-'));
    try {
      const autopilot = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-deny',
            mode: 'autopilot',
            active: true,
            current_phase: 'ralplan',
          },
        },
      });
      assert.equal(autopilot.isError, undefined);

      const denied = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-deny',
            mode: 'team',
            active: true,
            current_phase: 'running',
          },
        },
      });

      assert.equal(denied.isError, true);
      assert.match(denied.content[0]?.text || '', /retired.*read-only compatibility/i);
      assert.equal(existsSync(join(wd, '.nomx', 'state', 'sessions', 'sess-deny', 'team-state.json')), false);

      const canonical = JSON.parse(
        await readFile(join(wd, '.nomx', 'state', 'sessions', 'sess-deny', 'skill-active-state.json'), 'utf-8'),
      ) as { active_skills?: Array<{ skill: string }> };
      assert.deepEqual(canonical.active_skills?.map((entry) => entry.skill), ['autopilot']);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('allows ultrawork when canonical session state is stricter than mode files', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-canonical-prevalidate-'));
    try {
      await mkdir(join(wd, '.nomx', 'state', 'sessions', 'sess-canonical-deny'), { recursive: true });
      await writeFile(
        join(wd, '.nomx', 'state', 'team-state.json'),
        JSON.stringify({ active: true, mode: 'team', current_phase: 'running' }, null, 2),
      );
      await writeFile(
        join(wd, '.nomx', 'state', 'skill-active-state.json'),
        JSON.stringify({
          version: 1,
          active: true,
          skill: 'team',
          active_skills: [{ skill: 'team', phase: 'running', active: true }],
        }, null, 2),
      );
      await writeFile(
        join(wd, '.nomx', 'state', 'sessions', 'sess-canonical-deny', 'skill-active-state.json'),
        JSON.stringify({
          version: 1,
          active: true,
          skill: 'team',
          session_id: 'sess-canonical-deny',
          active_skills: [
            { skill: 'team', phase: 'running', active: true },
            { skill: 'ralph', phase: 'executing', active: true, session_id: 'sess-canonical-deny' },
          ],
        }, null, 2),
      );

      const allowed = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-canonical-deny',
            mode: 'ultrawork',
            active: true,
            current_phase: 'planning',
          },
        },
      });

      assert.equal(allowed.isError, undefined);
      assert.equal(
        existsSync(join(wd, '.nomx', 'state', 'sessions', 'sess-canonical-deny', 'ultrawork-state.json')),
        true,
      );
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('removes tracked workflows from canonical skill-active state on all_sessions clear', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-canonical-clear-all-'));
    try {
      const stateDir = join(wd, '.nomx', 'state');
      const sessionDir = join(stateDir, 'sessions', 'sess-retired-team');
      const legacyTeam = { mode: 'team', active: true, current_phase: 'running' };
      const legacyCanonical = {
        version: 1,
        active: true,
        skill: 'team',
        phase: 'running',
        active_skills: [{ skill: 'team', phase: 'running', active: true }],
      };
      await mkdir(sessionDir, { recursive: true });
      await writeFile(join(stateDir, 'team-state.json'), JSON.stringify(legacyTeam, null, 2));
      await writeFile(join(stateDir, 'run-state.json'), JSON.stringify({ ...legacyTeam, version: 1 }, null, 2));
      await writeFile(join(sessionDir, 'team-state.json'), JSON.stringify({
        ...legacyTeam,
        session_id: 'sess-retired-team',
      }, null, 2));
      await writeFile(join(sessionDir, 'run-state.json'), JSON.stringify({
        ...legacyTeam,
        version: 1,
        session_id: 'sess-retired-team',
      }, null, 2));
      await writeFile(join(stateDir, 'skill-active-state.json'), JSON.stringify(legacyCanonical, null, 2));
      await writeFile(join(sessionDir, 'skill-active-state.json'), JSON.stringify({
        ...legacyCanonical,
        session_id: 'sess-retired-team',
        active_skills: [{
          skill: 'team',
          phase: 'running',
          active: true,
          session_id: 'sess-retired-team',
        }],
      }, null, 2));

      await handleStateToolCall({
        params: {
          name: 'state_clear',
          arguments: {
            workingDirectory: wd,
            mode: 'team',
            all_sessions: true,
          },
        },
      });

      const canonicalPath = join(wd, '.nomx', 'state', 'skill-active-state.json');
      const canonical = JSON.parse(await readFile(canonicalPath, 'utf-8')) as {
        active: boolean;
        active_skills?: unknown[];
      };
      assert.equal(canonical.active, false);
      assert.deepEqual(canonical.active_skills, []);
      assert.equal(existsSync(join(stateDir, 'team-state.json')), false);
      assert.equal(existsSync(join(sessionDir, 'team-state.json')), false);
      assert.equal(existsSync(join(stateDir, 'run-state.json')), false);
      assert.equal(existsSync(join(sessionDir, 'run-state.json')), false);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('does not propagate root clears into isolated session canonical copies', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-root-clear-propagate-'));
    try {
      const stateDir = join(wd, '.nomx', 'state');
      await mkdir(stateDir, { recursive: true });
      await writeFile(join(stateDir, 'team-state.json'), JSON.stringify({
        mode: 'team',
        active: true,
        current_phase: 'running',
      }, null, 2));
      await writeFile(join(stateDir, 'skill-active-state.json'), JSON.stringify({
        version: 1,
        active: true,
        skill: 'team',
        phase: 'running',
        active_skills: [{ skill: 'team', phase: 'running', active: true }],
      }, null, 2));
      await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-root-clear',
            mode: 'ralph',
            active: true,
            iteration: 1,
            max_iterations: 3,
            current_phase: 'executing',
          },
        },
      });

      await handleStateToolCall({
        params: {
          name: 'state_clear',
          arguments: {
            workingDirectory: wd,
            mode: 'team',
          },
        },
      });

      const sessionCanonical = JSON.parse(
        await readFile(
          join(wd, '.nomx', 'state', 'sessions', 'sess-root-clear', 'skill-active-state.json'),
          'utf-8',
        ),
      ) as { active_skills?: Array<{ skill: string }> };
      assert.deepEqual(sessionCanonical.active_skills?.map((entry) => entry.skill), ['ralph']);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('keeps root-scoped team state out of session-scoped ralph canonical state', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-team-ralph-'));
    try {
      const stateDir = join(wd, '.nomx', 'state');
      await mkdir(stateDir, { recursive: true });
      await writeFile(join(stateDir, 'team-state.json'), JSON.stringify({
        mode: 'team',
        active: true,
        current_phase: 'running',
      }, null, 2));
      await writeFile(join(stateDir, 'skill-active-state.json'), JSON.stringify({
        version: 1,
        active: true,
        skill: 'team',
        phase: 'running',
        active_skills: [{ skill: 'team', phase: 'running', active: true }],
      }, null, 2));

      const ralphWrite = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-team-ralph',
            mode: 'ralph',
            active: true,
            iteration: 1,
            max_iterations: 5,
            current_phase: 'executing',
          },
        },
      });
      assert.equal(ralphWrite.isError, undefined);

      const rootCanonical = JSON.parse(
        await readFile(join(wd, '.nomx', 'state', 'skill-active-state.json'), 'utf-8'),
      ) as { active_skills?: Array<{ skill: string; phase?: string; session_id?: string }> };
      assert.deepEqual(
        rootCanonical.active_skills?.map(({ skill, phase, session_id }) => ({
          skill,
          phase,
          session_id,
        })),
        [{ skill: 'team', phase: 'running', session_id: undefined }],
      );

      const sessionCanonical = JSON.parse(
        await readFile(
          join(wd, '.nomx', 'state', 'sessions', 'sess-team-ralph', 'skill-active-state.json'),
          'utf-8',
        ),
      ) as { active_skills?: Array<{ skill: string; phase?: string; session_id?: string }> };
      assert.deepEqual(
        sessionCanonical.active_skills?.map(({ skill, phase, session_id }) => ({
          skill,
          phase,
          session_id,
        })),
        [{ skill: 'ralph', phase: 'executing', session_id: 'sess-team-ralph' }],
      );
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('rejects retired Team activation without mutating canonical state', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-standalone-overlap-'));
    try {
      const autopilotWrite = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-standalone',
            mode: 'autopilot',
            active: true,
            current_phase: 'planning',
          },
        },
      });
      assert.equal(autopilotWrite.isError, undefined);

      const invalidTeamWrite = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-standalone',
            mode: 'team',
            active: true,
            current_phase: 'starting',
          },
        },
      });

      assert.equal(invalidTeamWrite.isError, true);
      const body = JSON.parse(invalidTeamWrite.content[0]?.text || '{}') as { error?: string };
      assert.match(body.error || '', /retired.*read-only compatibility/i);

      const canonical = JSON.parse(
        await readFile(
          join(wd, '.nomx', 'state', 'sessions', 'sess-standalone', 'skill-active-state.json'),
          'utf-8',
        ),
      ) as { active_skills?: Array<{ skill: string; phase?: string; session_id?: string }> };
      assert.deepEqual(
        canonical.active_skills?.map(({ skill, phase, session_id }) => ({
          skill,
          phase,
          session_id,
        })),
        [{ skill: 'autopilot', phase: 'planning', session_id: 'sess-standalone' }],
      );
      assert.equal(existsSync(join(wd, '.nomx', 'state', 'sessions', 'sess-standalone', 'team-state.json')), false);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('auto-completes deep-interview when starting ralplan and returns transition messaging', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-handoff-interview-'));
    try {
      await mkdir(join(wd, '.nomx', 'state', 'sessions', 'sess-handoff'), { recursive: true });
      await writeFile(
        join(wd, '.nomx', 'state', 'sessions', 'sess-handoff', 'deep-interview-state.json'),
        JSON.stringify({
          active: true,
          mode: 'deep-interview',
          current_phase: 'intent-first',
          deep_interview_gate: {
            status: 'complete',
            rationale: 'Requirements are clarified and ready for ralplan consensus.',
          },
        }, null, 2),
      );

      const response = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-handoff',
            mode: 'ralplan',
            active: true,
            current_phase: 'planning',
          },
        },
      });

      assert.equal(response.isError, undefined);
      const body = JSON.parse(response.content[0]?.text || '{}') as { transition?: string };
      assert.equal(body.transition, 'mode transiting: deep-interview -> ralplan');

      const completed = JSON.parse(
        await readFile(join(wd, '.nomx', 'state', 'sessions', 'sess-handoff', 'deep-interview-state.json'), 'utf-8'),
      ) as {
        active?: boolean;
        current_phase?: string;
        completed_at?: string;
        auto_completed_reason?: string;
        run_outcome?: string;
      };
      assert.equal(completed.active, false);
      assert.equal(completed.current_phase, 'completed');
      assert.equal(typeof completed.completed_at, 'string');
      assert.equal(completed.run_outcome, 'finish');
      assert.match(completed.auto_completed_reason || '', /mode transiting: deep-interview -> ralplan/);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('rejects execution-to-planning rollback with clear-first guidance', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-rollback-'));
    try {
      await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-rollback',
            mode: 'ralph',
            active: true,
            current_phase: 'executing',
          },
        },
      });

      const denied = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-rollback',
            mode: 'ralplan',
            active: true,
            current_phase: 'planning',
          },
        },
      });

      assert.equal(denied.isError, true);
      const body = JSON.parse(denied.content[0]?.text || '{}') as { error?: string };
      assert.match(body.error || '', /Execution-to-planning rollback auto-complete is not allowed/i);
      assert.match(body.error || '', /First clear current state first and retry if this action is intended/i);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('does not auto-complete existing workflow state when tracked write validation fails', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-validate-before-transition-'));
    try {
      await mkdir(join(wd, '.nomx', 'state', 'sessions', 'sess-invalid'), { recursive: true });
      await writeFile(
        join(wd, '.nomx', 'state', 'sessions', 'sess-invalid', 'ralplan-state.json'),
        JSON.stringify({ active: true, mode: 'ralplan', current_phase: 'planning' }, null, 2),
      );

      const denied = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-invalid',
            mode: 'ralph',
            active: true,
            current_phase: 'definitely-invalid',
          },
        },
      });

      assert.equal(denied.isError, true);
      const body = JSON.parse(denied.content[0]?.text || '{}') as { error?: string };
      assert.match(body.error || '', /ralph\.current_phase/i);

      const ralplanState = JSON.parse(
        await readFile(join(wd, '.nomx', 'state', 'sessions', 'sess-invalid', 'ralplan-state.json'), 'utf-8'),
      ) as Record<string, unknown>;
      assert.equal(ralplanState.active, true);
      assert.equal(ralplanState.current_phase, 'planning');
      assert.equal(existsSync(join(wd, '.nomx', 'state', 'sessions', 'sess-invalid', 'ralph-state.json')), false);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('allows ultrawork overlap with any tracked mode', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-ultrawork-any-'));
    try {
      const first = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-ulw',
            mode: 'autopilot',
            active: true,
            current_phase: 'planning',
          },
        },
      });
      assert.equal(first.isError, undefined);

      const second = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-ulw',
            mode: 'ultrawork',
            active: true,
            current_phase: 'planning',
          },
        },
      });
      assert.equal(second.isError, undefined);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('keeps session-scoped workflow states isolated across writes and clears', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-session-isolation-'));
    try {
      const writeA = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-a',
            mode: 'deep-interview',
            active: true,
            current_phase: 'interview-a',
          },
        },
      });
      assert.equal(writeA.isError, undefined);

      const writeB = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-b',
            mode: 'ralph',
            active: true,
            iteration: 1,
            max_iterations: 3,
            current_phase: 'executing',
          },
        },
      });
      assert.equal(writeB.isError, undefined);

      await handleStateToolCall({
        params: {
          name: 'state_clear',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-b',
            mode: 'ralph',
          },
        },
      });

      const sessionAState = JSON.parse(
        await readFile(join(wd, '.nomx', 'state', 'sessions', 'sess-a', 'deep-interview-state.json'), 'utf-8'),
      ) as Record<string, unknown>;
      assert.equal(sessionAState.active, true);
      assert.equal(sessionAState.current_phase, 'interview-a');

      const sessionACanonical = JSON.parse(
        await readFile(join(wd, '.nomx', 'state', 'sessions', 'sess-a', 'skill-active-state.json'), 'utf-8'),
      ) as { active_skills?: Array<{ skill: string; session_id?: string }> };
      assert.deepEqual(
        sessionACanonical.active_skills?.map(({ skill, session_id }) => ({ skill, session_id })),
        [{ skill: 'deep-interview', session_id: 'sess-a' }],
      );
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('does not auto-complete session workflows from root-scoped workflow writes', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-root-session-isolation-'));
    try {
      await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-interview',
            mode: 'deep-interview',
            active: true,
            current_phase: 'asking',
          },
        },
      });

      const rootWrite = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            mode: 'ralplan',
            active: true,
            current_phase: 'planning',
          },
        },
      });
      assert.equal(rootWrite.isError, undefined);

      const sessionState = JSON.parse(
        await readFile(join(wd, '.nomx', 'state', 'sessions', 'sess-interview', 'deep-interview-state.json'), 'utf-8'),
      ) as Record<string, unknown>;
      assert.equal(sessionState.active, true);
      assert.equal(sessionState.current_phase, 'asking');
      assert.equal(sessionState.auto_completed_reason, undefined);

      const sessionCanonical = JSON.parse(
        await readFile(join(wd, '.nomx', 'state', 'sessions', 'sess-interview', 'skill-active-state.json'), 'utf-8'),
      ) as { active_skills?: Array<{ skill: string; session_id?: string }> };
      assert.deepEqual(
        sessionCanonical.active_skills?.map(({ skill, session_id }) => ({ skill, session_id })),
        [{ skill: 'deep-interview', session_id: 'sess-interview' }],
      );

      const rootState = JSON.parse(await readFile(join(wd, '.nomx', 'state', 'ralplan-state.json'), 'utf-8')) as Record<string, unknown>;
      assert.equal(rootState.active, true);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('keeps session canonical state when clearing the root scope without all_sessions', async () => {
    process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';
    const { handleStateToolCall } = await import('../state-server.js');

    const wd = await mkdtemp(join(tmpdir(), 'nomx-state-server-root-clear-isolation-'));
    try {
      await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            session_id: 'sess-keep',
            mode: 'deep-interview',
            active: true,
            current_phase: 'asking',
          },
        },
      });
      await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            workingDirectory: wd,
            mode: 'deep-interview',
            active: true,
            current_phase: 'root-asking',
          },
        },
      });

      await handleStateToolCall({
        params: {
          name: 'state_clear',
          arguments: {
            workingDirectory: wd,
            mode: 'deep-interview',
          },
        },
      });

      assert.equal(existsSync(join(wd, '.nomx', 'state', 'deep-interview-state.json')), false);
      const sessionState = JSON.parse(
        await readFile(join(wd, '.nomx', 'state', 'sessions', 'sess-keep', 'deep-interview-state.json'), 'utf-8'),
      ) as Record<string, unknown>;
      assert.equal(sessionState.active, true);

      const sessionCanonical = JSON.parse(
        await readFile(join(wd, '.nomx', 'state', 'sessions', 'sess-keep', 'skill-active-state.json'), 'utf-8'),
      ) as { active_skills?: Array<{ skill: string; session_id?: string }> };
      assert.deepEqual(
        sessionCanonical.active_skills?.map(({ skill, session_id }) => ({ skill, session_id })),
        [{ skill: 'deep-interview', session_id: 'sess-keep' }],
      );
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

});
