import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildWorkflowTransitionMessage,
  buildWorkflowTransitionError,
  evaluateWorkflowTransition,
  readActiveWorkflowModes,
} from '../workflow-transition.js';
import { reconcileWorkflowTransition } from '../workflow-transition-reconcile.js';

const STATE_ENV_KEYS = [
  'NOMX_ROOT',
  'NOMX_STATE_ROOT',
  'NOMX_TEAM_STATE_ROOT',
  'NOMX_SESSION_ID',
  'CODEX_SESSION_ID',
  'SESSION_ID',
] as const;

async function withIsolatedStateEnv(fn: () => Promise<void>): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const key of STATE_ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  try {
    await fn();
  } finally {
    for (const key of STATE_ENV_KEYS) {
      const value = previous.get(key);
      if (typeof value === 'string') process.env[key] = value;
      else delete process.env[key];
    }
  }
}

describe('workflow transition rules', () => {
  it('treats retired Team state as read-only history outside the active overlap matrix', () => {
    const cases: Array<{
      current: string[];
      requested: 'team' | 'ralph' | 'ultrawork' | 'autopilot';
      allowed: boolean;
      resulting: string[];
    }> = [
      { current: [], requested: 'team', allowed: false, resulting: [] },
      { current: ['team'], requested: 'ralph', allowed: true, resulting: ['ralph'] },
      { current: ['ralph'], requested: 'team', allowed: false, resulting: ['ralph'] },
      { current: ['team'], requested: 'ultrawork', allowed: true, resulting: ['ultrawork'] },
      { current: ['ultrawork'], requested: 'team', allowed: false, resulting: ['ultrawork'] },
      { current: ['ralph'], requested: 'ultrawork', allowed: true, resulting: ['ralph', 'ultrawork'] },
      { current: ['ultrawork'], requested: 'ralph', allowed: true, resulting: ['ultrawork', 'ralph'] },
      { current: ['autopilot'], requested: 'team', allowed: false, resulting: ['autopilot'] },
      { current: ['team'], requested: 'autopilot', allowed: true, resulting: ['autopilot'] },
      { current: ['team', 'ralph'], requested: 'ultrawork', allowed: true, resulting: ['ralph', 'ultrawork'] },
      { current: ['team', 'ultrawork'], requested: 'ralph', allowed: true, resulting: ['ultrawork', 'ralph'] },
    ];

    for (const testCase of cases) {
      const decision = evaluateWorkflowTransition(testCase.current, testCase.requested);
      assert.equal(decision.allowed, testCase.allowed, `${testCase.current.join(',')} -> ${testCase.requested}`);
      assert.deepEqual(decision.resultingModes, testCase.resulting, `${testCase.current.join(',')} -> ${testCase.requested}`);
    }
  });

  it('builds explicit read-only compatibility guidance for retired Team requests', () => {
    const error = buildWorkflowTransitionError([], 'team', 'start');
    assert.match(error, /Cannot start team: the Team workflow is retired/i);
    assert.match(error, /read-only compatibility/i);
    assert.match(error, /native Codex subagents/i);
  });

  it('returns auto-complete decisions for allowlisted forward transitions', () => {
    const interviewToRalplan = evaluateWorkflowTransition(['deep-interview'], 'ralplan');
    assert.equal(interviewToRalplan.allowed, true);
    assert.equal(interviewToRalplan.kind, 'auto-complete');
    assert.deepEqual(interviewToRalplan.autoCompleteModes, ['deep-interview']);
    assert.deepEqual(interviewToRalplan.resultingModes, ['ralplan']);
    assert.equal(interviewToRalplan.transitionMessage, 'mode transiting: deep-interview -> ralplan');

    const interviewToUltragoal = evaluateWorkflowTransition(['deep-interview'], 'ultragoal');
    assert.equal(interviewToUltragoal.allowed, true);
    assert.equal(interviewToUltragoal.kind, 'auto-complete');
    assert.deepEqual(interviewToUltragoal.autoCompleteModes, ['deep-interview']);
    assert.deepEqual(interviewToUltragoal.resultingModes, ['ultragoal']);
    assert.equal(interviewToUltragoal.transitionMessage, 'mode transiting: deep-interview -> ultragoal');

    const ralplanToRalph = evaluateWorkflowTransition(['ralplan', 'ultrawork'], 'ralph');
    assert.equal(ralplanToRalph.allowed, true);
    assert.equal(ralplanToRalph.kind, 'auto-complete');
    assert.deepEqual(ralplanToRalph.autoCompleteModes, ['ralplan']);
    assert.deepEqual(ralplanToRalph.resultingModes, ['ultrawork', 'ralph']);

    const ralplanToUltragoal = evaluateWorkflowTransition(['ralplan'], 'ultragoal');
    assert.equal(ralplanToUltragoal.allowed, true);
    assert.equal(ralplanToUltragoal.kind, 'auto-complete');
    assert.deepEqual(ralplanToUltragoal.autoCompleteModes, ['ralplan']);
    assert.deepEqual(ralplanToUltragoal.resultingModes, ['ultragoal']);
    assert.equal(ralplanToUltragoal.transitionMessage, 'mode transiting: ralplan -> ultragoal');

  });

  it('builds rollback denial guidance for execution-to-planning transitions', () => {
    const error = buildWorkflowTransitionError(['ralph'], 'ralplan', 'start');
    assert.match(error, /Execution-to-planning rollback auto-complete is not allowed\./);
    assert.match(error, /First clear current state first and retry if this action is intended\./);
    assert.match(error, /Clear incompatible workflow state yourself via/);
  });


  it('does not auto-complete Autopilot when starting ralplan as a child-stage name', () => {
    const decision = evaluateWorkflowTransition(['autopilot'], 'ralplan');
    assert.equal(decision.allowed, false);
    assert.equal(decision.kind, 'deny');
    assert.equal(decision.denialReason, 'rollback');
    assert.deepEqual(decision.autoCompleteModes, []);
    assert.deepEqual(decision.resultingModes, ['autopilot']);
  });

  it('formats transition audit messages', () => {
    assert.equal(
      buildWorkflowTransitionMessage('ralplan', 'ralph'),
      'mode transiting: ralplan -> ralph',
    );
  });

  it('ignores stale root workflow state for session-scoped active decisions', async () => {
    await withIsolatedStateEnv(async () => {
      const wd = await mkdtemp(join(tmpdir(), 'nomx-workflow-active-scope-'));
      try {
        const stateDir = join(wd, '.nomx', 'state');
        const sessionDir = join(stateDir, 'sessions', 'sess-current');
        await mkdir(sessionDir, { recursive: true });
        await writeFile(
          join(stateDir, 'ralph-state.json'),
          JSON.stringify({ active: true, mode: 'ralph', current_phase: 'executing' }, null, 2),
          'utf-8',
        );
        await writeFile(
          join(stateDir, 'session.json'),
          JSON.stringify({ session_id: 'sess-current', cwd: wd }, null, 2),
          'utf-8',
        );

        assert.deepEqual(await readActiveWorkflowModes(wd, 'sess-current'), []);
        assert.deepEqual(await readActiveWorkflowModes(wd), []);
      } finally {
        await rm(wd, { recursive: true, force: true });
      }
    });
  });

  it('does not auto-complete stale root workflow state during a session transition', async () => {
    await withIsolatedStateEnv(async () => {
      const wd = await mkdtemp(join(tmpdir(), 'nomx-workflow-reconcile-scope-'));
      try {
        const stateDir = join(wd, '.nomx', 'state');
        const sessionDir = join(stateDir, 'sessions', 'sess-current');
        const rootRalphPath = join(stateDir, 'ralph-state.json');
        await mkdir(sessionDir, { recursive: true });
        await writeFile(
          rootRalphPath,
          JSON.stringify({ active: true, mode: 'ralph', current_phase: 'executing' }, null, 2),
          'utf-8',
        );

        const transition = await reconcileWorkflowTransition(wd, 'ralplan', {
          action: 'start',
          sessionId: 'sess-current',
          source: 'test',
        });

        assert.equal(transition.decision.allowed, true);
        assert.deepEqual(transition.decision.currentModes, []);
        assert.deepEqual(transition.completedPaths, []);

        const rootRalph = JSON.parse(await readFile(rootRalphPath, 'utf-8')) as { active?: unknown };
        assert.equal(rootRalph.active, true);
        assert.equal(existsSync(join(sessionDir, 'ralph-state.json')), false);
      } finally {
        await rm(wd, { recursive: true, force: true });
      }
    });
  });

  it('does not auto-complete session mode detail when canonical skill state is absent', async () => {
    await withIsolatedStateEnv(async () => {
      const wd = await mkdtemp(join(tmpdir(), 'nomx-workflow-reconcile-detail-only-'));
      try {
        const sessionId = 'sess-detail-only';
        const sessionDir = join(wd, '.nomx', 'state', 'sessions', sessionId);
        const staleRalplanPath = join(sessionDir, 'ralplan-state.json');
        await mkdir(sessionDir, { recursive: true });
        await writeFile(
          staleRalplanPath,
          JSON.stringify({ active: true, mode: 'ralplan', current_phase: 'review' }, null, 2),
          'utf-8',
        );

        await assert.rejects(
          reconcileWorkflowTransition(wd, 'team', {
            action: 'start',
            sessionId,
            source: 'test',
          }),
          /Team workflow is retired/i,
        );

        const staleRalplan = JSON.parse(await readFile(staleRalplanPath, 'utf-8')) as { active?: unknown };
        assert.equal(staleRalplan.active, true);
      } finally {
        await rm(wd, { recursive: true, force: true });
      }
    });
  });

  it('lets terminal Team detail outrank a foreign compatibility mirror without touching foreign state', async () => {
    await withIsolatedStateEnv(async () => {
      const wd = await mkdtemp(join(tmpdir(), 'nomx-workflow-foreign-team-terminal-'));
      try {
        const stateDir = join(wd, '.nomx', 'state');
        await mkdir(stateDir, { recursive: true });
        const teamState = { active: false, mode: 'team', current_phase: 'cancelled', run_outcome: 'continue' };
        const skillState = {
          version: 1,
          active: true,
          skill: 'team',
          phase: 'team-exec',
          current_phase: 'cancelled',
          session_id: 'foreign-team-session',
          active_skills: [{ skill: 'team', phase: 'team-exec', active: true }],
        };
        const runState = { version: 1, mode: 'team', active: true, outcome: 'continue', current_phase: 'team-exec' };
        await writeFile(join(stateDir, 'team-state.json'), JSON.stringify(teamState, null, 2));
        await writeFile(join(stateDir, 'skill-active-state.json'), JSON.stringify(skillState, null, 2));
        await writeFile(join(stateDir, 'run-state.json'), JSON.stringify(runState, null, 2));

        const transition = await reconcileWorkflowTransition(wd, 'deep-interview', {
          action: 'write',
          source: 'test',
        });

        assert.equal(transition.decision.allowed, true);
        assert.deepEqual(transition.decision.currentModes, []);
        assert.deepEqual(transition.completedPaths, []);
        assert.deepEqual(JSON.parse(await readFile(join(stateDir, 'team-state.json'), 'utf-8')), teamState);
        assert.deepEqual(JSON.parse(await readFile(join(stateDir, 'skill-active-state.json'), 'utf-8')), skillState);
        assert.deepEqual(JSON.parse(await readFile(join(stateDir, 'run-state.json'), 'utf-8')), runState);
      } finally {
        await rm(wd, { recursive: true, force: true });
      }
    });
  });

  it('ignores genuinely active legacy Team detail during retained workflow transitions', async () => {
    await withIsolatedStateEnv(async () => {
      const wd = await mkdtemp(join(tmpdir(), 'nomx-workflow-foreign-team-active-'));
      try {
        const stateDir = join(wd, '.nomx', 'state');
        await mkdir(stateDir, { recursive: true });
        await writeFile(join(stateDir, 'team-state.json'), JSON.stringify({
          active: true,
          mode: 'team',
          current_phase: 'team-exec',
        }, null, 2));
        await writeFile(join(stateDir, 'skill-active-state.json'), JSON.stringify({
          version: 1,
          active: true,
          skill: 'team',
          session_id: 'foreign-team-session',
          active_skills: [{ skill: 'team', phase: 'team-exec', active: true }],
        }, null, 2));

        const transition = await reconcileWorkflowTransition(wd, 'deep-interview', {
          action: 'write',
          source: 'test',
        });
        assert.equal(transition.decision.allowed, true);
        assert.deepEqual(transition.decision.currentModes, []);
      } finally {
        await rm(wd, { recursive: true, force: true });
      }
    });
  });
  it('co-locates auto-completed mode detail and canonical skill state under an explicit base state dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nomx-workflow-reconcile-base-dir-'));
    try {
      const wd = join(root, 'source');
      const baseStateDir = join(root, 'boxed-state');
      const sessionId = 'sess-transition-base-dir';
      const sessionDir = join(baseStateDir, 'sessions', sessionId);
      await mkdir(sessionDir, { recursive: true });
      await writeFile(
        join(sessionDir, 'deep-interview-state.json'),
        JSON.stringify({
          active: true,
          mode: 'deep-interview',
          current_phase: 'interviewing',
          deep_interview_gate: {
            status: 'complete',
            rationale: 'Requirements have been clarified and handed to ralplan.',
          },
          input_lock: {
            active: true,
            owner: 'handoff-question',
          },
          approval_lock: {
            status: 'pending',
            reviewer: 'user',
          },
        }, null, 2),
        'utf-8',
      );
      await writeFile(
        join(sessionDir, 'skill-active-state.json'),
        JSON.stringify({
          version: 1,
          active: true,
          skill: 'deep-interview',
          phase: 'interviewing',
          active_skills: [
            {
              skill: 'deep-interview',
              phase: 'interviewing',
              active: true,
              session_id: sessionId,
            },
          ],
        }, null, 2),
        'utf-8',
      );

      const transition = await reconcileWorkflowTransition(wd, 'ralplan', {
        action: 'start',
        sessionId,
        source: 'test',
        baseStateDir,
      });

      const boxedModePath = join(sessionDir, 'deep-interview-state.json');
      assert.equal(transition.decision.allowed, true);
      assert.deepEqual(transition.completedPaths, [boxedModePath]);

      const boxedMode = JSON.parse(await readFile(boxedModePath, 'utf-8')) as Record<string, unknown>;
      assert.equal(boxedMode.active, false);
      assert.equal(boxedMode.current_phase, 'completed');
      const boxedInputLock = boxedMode.input_lock as Record<string, unknown>;
      const boxedApprovalLock = boxedMode.approval_lock as Record<string, unknown>;
      assert.equal(boxedInputLock.active, false);
      assert.equal(boxedInputLock.status, 'released');
      assert.equal(boxedApprovalLock.active, false);
      assert.equal(boxedApprovalLock.status, 'released');

      const boxedSkill = JSON.parse(await readFile(join(sessionDir, 'skill-active-state.json'), 'utf-8')) as Record<string, unknown>;
      assert.equal(boxedSkill.active, false);

      assert.equal(existsSync(join(wd, '.nomx', 'state', 'sessions', sessionId, 'deep-interview-state.json')), false);
      assert.equal(existsSync(join(wd, '.nomx', 'state', 'sessions', sessionId, 'skill-active-state.json')), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('denies deep-interview to ralplan reconciliation when only handoff-cleared question evidence exists', async () => {
    await withIsolatedStateEnv(async () => {
      const root = await mkdtemp(join(tmpdir(), 'nomx-workflow-reconcile-ralplan-gate-deny-'));
      try {
        const wd = join(root, 'source');
        const baseStateDir = join(root, 'boxed-state');
        const sessionId = 'sess-transition-gate-deny';
        const sessionDir = join(baseStateDir, 'sessions', sessionId);
        await mkdir(sessionDir, { recursive: true });
        await writeFile(
          join(sessionDir, 'deep-interview-state.json'),
          JSON.stringify({
            active: true,
            mode: 'deep-interview',
            current_phase: 'interviewing',
            question_enforcement: {
              obligation_id: 'obligation-cleared',
              source: 'nomx-question',
              status: 'cleared',
              lifecycle_outcome: 'askuserQuestion',
              requested_at: '2026-05-28T00:00:00.000Z',
              cleared_at: '2026-05-28T00:01:00.000Z',
              clear_reason: 'handoff',
            },
          }, null, 2),
          'utf-8',
        );
        await writeFile(
          join(sessionDir, 'skill-active-state.json'),
          JSON.stringify({
            version: 1,
            active: true,
            skill: 'deep-interview',
            phase: 'interviewing',
            active_skills: [
              {
                skill: 'deep-interview',
                phase: 'interviewing',
                active: true,
                session_id: sessionId,
              },
            ],
          }, null, 2),
          'utf-8',
        );

        await assert.rejects(
          reconcileWorkflowTransition(wd, 'ralplan', {
            action: 'start',
            sessionId,
            source: 'test',
            baseStateDir,
          }),
          /cleared deep-interview question obligations with handoff\/error are not completion evidence/i,
        );

        const boxedMode = JSON.parse(await readFile(join(sessionDir, 'deep-interview-state.json'), 'utf-8')) as Record<string, unknown>;
        assert.equal(boxedMode.active, true);
        assert.equal(boxedMode.current_phase, 'interviewing');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

});
