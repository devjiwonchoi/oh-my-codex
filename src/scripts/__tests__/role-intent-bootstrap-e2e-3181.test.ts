import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ralplanCommand } from '../../cli/ralplan.js';
import { readSubagentTrackingState, recordSubagentTurnForSession } from '../../subagents/tracker.js';
import { dispatchCodexNativeHook } from '../codex-native-hook.js';

async function invokeRoleIntent(cwd: string, args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const previous = process.exitCode;
  try {
    process.exitCode = undefined;
    await ralplanCommand(args, { cwd: () => cwd, stdout: (l) => stdout.push(l), stderr: (l) => stderr.push(l) });
    return { stdout, stderr, exitCode: process.exitCode };
  } finally {
    process.exitCode = previous;
  }
}

describe('#3181 end-to-end fresh App turn bootstrap', () => {
  it('SessionStart reconcile alone neither attests nor authorizes a role intent (fail-closed; positive provenance required)', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nomx-3181-e2e-'));
    const priorEnv = { NOMX_SESSION_ID: process.env.NOMX_SESSION_ID, CODEX_SESSION_ID: process.env.CODEX_SESSION_ID, SESSION_ID: process.env.SESSION_ID };
    try {
      delete process.env.NOMX_SESSION_ID;
      delete process.env.CODEX_SESSION_ID;
      delete process.env.SESSION_ID;
      const nativeSessionId = 'codex-native-fresh-app';

      // 1. Fresh native App turn start: no session.json, no tracker yet.
      await dispatchCodexNativeHook(
        { hook_event_name: 'SessionStart', cwd, session_id: nativeSessionId },
        { cwd, sessionOwnerPid: process.pid },
      );

      // 2. SessionStart reconciles the canonical pointer but does NOT attest a leader
      //    (a null transcript cannot positively classify a root vs a malformed child) and
      //    writes no positively-provenanced tracker leader.
      const afterStart = await readSubagentTrackingState(cwd);
      assert.equal(afterStart.sessions[nativeSessionId]?.leader_attested_at, undefined, 'SessionStart must not attest a leader');

      // 3. A role-intent write on the reconciled-pointer-only session FAILS CLOSED: the bare
      //    session.json native_session_id is not a trusted leader anchor (an ambiguous /
      //    malformed-child SessionStart could set it). Authorization requires positive
      //    provenance — a PreToolUse attestation (next test) or a recorded tracker leader.
      const res = await invokeRoleIntent(cwd, ['role-intent', 'write', '--role', 'architect', '--parent-thread', nativeSessionId, '--json']);
      assert.equal(res.exitCode, 1);
      assert.deepEqual(JSON.parse(res.stdout.join('\n')), { ok: false, reason: 'parent_not_active_leader' });

      const finalState = await readSubagentTrackingState(cwd);
      assert.deepEqual(finalState.pending_role_intents, []);
    } finally {
      if (priorEnv.NOMX_SESSION_ID !== undefined) process.env.NOMX_SESSION_ID = priorEnv.NOMX_SESSION_ID;
      if (priorEnv.CODEX_SESSION_ID !== undefined) process.env.CODEX_SESSION_ID = priorEnv.CODEX_SESSION_ID;
      if (priorEnv.SESSION_ID !== undefined) process.env.SESSION_ID = priorEnv.SESSION_ID;
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('PreToolUse (leader turn) bootstraps the pointer + attestation when SessionStart did not, so the first role-intent write succeeds', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nomx-3181-e2e-pretool-'));
    const priorEnv = { NOMX_SESSION_ID: process.env.NOMX_SESSION_ID, CODEX_SESSION_ID: process.env.CODEX_SESSION_ID, SESSION_ID: process.env.SESSION_ID };
    try {
      delete process.env.NOMX_SESSION_ID;
      delete process.env.CODEX_SESSION_ID;
      delete process.env.SESSION_ID;
      const nativeSessionId = 'codex-native-exec-leader';

      // Fresh exec turn where the first event reaching NOMX is a leader PreToolUse (no
      // prior SessionStart pointer). The leader turn carries thread_id == session_id.
      await dispatchCodexNativeHook(
        {
          hook_event_name: 'PreToolUse',
          cwd,
          session_id: nativeSessionId,
          thread_id: nativeSessionId,
          tool_name: 'Bash',
          tool_use_id: 'tool-exec-first',
          tool_input: { command: 'nomx ralplan role-intent write --role architect --parent-thread "$CODEX_THREAD_ID" --json' },
        },
        { cwd, sessionOwnerPid: process.pid },
      );

      const afterPreTool = await readSubagentTrackingState(cwd);
      const attested = afterPreTool.sessions[nativeSessionId];
      assert.equal(attested?.leader_thread_id, nativeSessionId);
      assert.equal(attested?.leader_attest_source, 'native-pretooluse');

      const res = await invokeRoleIntent(cwd, ['role-intent', 'write', '--role', 'architect', '--parent-thread', nativeSessionId, '--json']);
      assert.equal(res.exitCode, undefined);
      const receipt = JSON.parse(res.stdout.join('\n')) as { ok: boolean; intent: { role: string } };
      assert.equal(receipt.ok, true);
      assert.equal(receipt.intent.role, 'architect');
      assert.equal((await readSubagentTrackingState(cwd)).pending_role_intents.length, 1);
    } finally {
      if (priorEnv.NOMX_SESSION_ID !== undefined) process.env.NOMX_SESSION_ID = priorEnv.NOMX_SESSION_ID;
      if (priorEnv.CODEX_SESSION_ID !== undefined) process.env.CODEX_SESSION_ID = priorEnv.CODEX_SESSION_ID;
      if (priorEnv.SESSION_ID !== undefined) process.env.SESSION_ID = priorEnv.SESSION_ID;
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('ignores a title-generation notify turn, then attests the actual same-session root turn', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nomx-3181-e2e-title-first-'));
    const priorEnv = { NOMX_SESSION_ID: process.env.NOMX_SESSION_ID, CODEX_SESSION_ID: process.env.CODEX_SESSION_ID, SESSION_ID: process.env.SESSION_ID };
    try {
      delete process.env.NOMX_SESSION_ID;
      delete process.env.CODEX_SESSION_ID;
      delete process.env.SESSION_ID;
      const nativeSessionId = 'codex-native-real-thread';
      const titleThreadId = 'codex-native-title-helper';
      await mkdir(join(cwd, '.nomx'), { recursive: true });
      await writeFile(join(cwd, '.nomx', 'managed'), '', 'utf8');

      // SessionStart establishes the canonical session but cannot itself prove
      // root ownership. The asynchronous title helper completes first with a
      // distinct thread id and must not seize tracker leadership.
      await dispatchCodexNativeHook(
        { hook_event_name: 'SessionStart', cwd, session_id: nativeSessionId },
        { cwd, sessionOwnerPid: process.pid },
      );
      execFileSync(process.execPath, [
        join(process.cwd(), 'dist', 'scripts', 'notify-hook.js'),
        JSON.stringify({
          cwd,
          type: 'agent-turn-complete',
          session_id: nativeSessionId,
          thread_id: titleThreadId,
          turn_id: 'title-turn',
          input_messages: ['Generate a short task title.'],
          last_assistant_message: 'Fix native session tracking',
        }),
      ], { cwd, stdio: 'pipe', env: process.env });
      assert.equal((await readSubagentTrackingState(cwd)).sessions[nativeSessionId], undefined);

      // The first real leader tool call is bound to the native session id. It
      // attests the actual app conversation even though SessionStart already
      // created the pointer.
      await dispatchCodexNativeHook(
        {
          hook_event_name: 'PreToolUse',
          cwd,
          session_id: nativeSessionId,
          thread_id: nativeSessionId,
          tool_name: 'Bash',
          tool_use_id: 'tool-real-root',
          tool_input: { command: 'nomx ralplan role-intent write --role architect --parent-thread "$CODEX_THREAD_ID" --json' },
        },
        { cwd, sessionOwnerPid: process.pid },
      );

      const res = await invokeRoleIntent(cwd, ['role-intent', 'write', '--role', 'architect', '--parent-thread', nativeSessionId, '--json']);
      assert.equal(res.exitCode, undefined);
      assert.equal(JSON.parse(res.stdout.join('\n')).ok, true);
    } finally {
      if (priorEnv.NOMX_SESSION_ID !== undefined) process.env.NOMX_SESSION_ID = priorEnv.NOMX_SESSION_ID;
      if (priorEnv.CODEX_SESSION_ID !== undefined) process.env.CODEX_SESSION_ID = priorEnv.CODEX_SESSION_ID;
      if (priorEnv.SESSION_ID !== undefined) process.env.SESSION_ID = priorEnv.SESSION_ID;
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('repairs pre-#3181 title-first tracker inference only for the persisted native root', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nomx-3181-e2e-title-repair-'));
    const priorEnv = { NOMX_SESSION_ID: process.env.NOMX_SESSION_ID, CODEX_SESSION_ID: process.env.CODEX_SESSION_ID, SESSION_ID: process.env.SESSION_ID };
    try {
      delete process.env.NOMX_SESSION_ID;
      delete process.env.CODEX_SESSION_ID;
      delete process.env.SESSION_ID;
      const nativeSessionId = 'codex-native-repair-root';
      await dispatchCodexNativeHook(
        { hook_event_name: 'SessionStart', cwd, session_id: nativeSessionId },
        { cwd, sessionOwnerPid: process.pid },
      );

      // Model the old notify-hook inference: its auxiliary title completion
      // became leader and the actual root was then stored as a subagent.
      await recordSubagentTurnForSession(cwd, { sessionId: nativeSessionId, threadId: 'title-helper', timestamp: new Date().toISOString() });
      await recordSubagentTurnForSession(cwd, { sessionId: nativeSessionId, threadId: nativeSessionId, timestamp: new Date().toISOString() });

      await dispatchCodexNativeHook(
        {
          hook_event_name: 'PreToolUse',
          cwd,
          session_id: nativeSessionId,
          thread_id: nativeSessionId,
          tool_name: 'Bash',
          tool_use_id: 'tool-repair-real-root',
          tool_input: { command: 'nomx ralplan role-intent write --role architect --parent-thread "$CODEX_THREAD_ID" --json' },
        },
        { cwd, sessionOwnerPid: process.pid },
      );

      const state = await readSubagentTrackingState(cwd);
      assert.equal(state.sessions[nativeSessionId]?.leader_thread_id, nativeSessionId);
      assert.equal(state.sessions[nativeSessionId]?.threads[nativeSessionId]?.kind, 'leader');
      const res = await invokeRoleIntent(cwd, ['role-intent', 'write', '--role', 'architect', '--parent-thread', nativeSessionId, '--json']);
      assert.equal(res.exitCode, undefined);
      assert.equal(JSON.parse(res.stdout.join('\n')).ok, true);
    } finally {
      if (priorEnv.NOMX_SESSION_ID !== undefined) process.env.NOMX_SESSION_ID = priorEnv.NOMX_SESSION_ID;
      if (priorEnv.CODEX_SESSION_ID !== undefined) process.env.CODEX_SESSION_ID = priorEnv.CODEX_SESSION_ID;
      if (priorEnv.SESSION_ID !== undefined) process.env.SESSION_ID = priorEnv.SESSION_ID;
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('never attests a thread durably tracked as a subagent, even via a source-less leader-shaped PreToolUse', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nomx-3181-e2e-child-'));
    const priorEnv = { NOMX_SESSION_ID: process.env.NOMX_SESSION_ID, CODEX_SESSION_ID: process.env.CODEX_SESSION_ID, SESSION_ID: process.env.SESSION_ID };
    try {
      delete process.env.NOMX_SESSION_ID;
      delete process.env.CODEX_SESSION_ID;
      delete process.env.SESSION_ID;
      const childThreadId = 'codex-native-child-thread';

      // A child is durably recorded as a subagent (e.g. at its own SessionStart).
      await recordSubagentTurnForSession(cwd, {
        sessionId: 'leader-session',
        threadId: childThreadId,
        kind: 'subagent',
        leaderThreadId: 'leader-session',
        timestamp: new Date().toISOString(),
      });

      // The child then emits a source-less, untyped, leader-shaped PreToolUse
      // (thread_id === session_id). It must NOT be promoted to leader.
      await dispatchCodexNativeHook(
        {
          hook_event_name: 'PreToolUse',
          cwd,
          session_id: childThreadId,
          thread_id: childThreadId,
          tool_name: 'Bash',
          tool_use_id: 'tool-child-selfpromote',
          tool_input: { command: 'nomx ralplan role-intent write --role architect --parent-thread "$CODEX_THREAD_ID" --json' },
        },
        { cwd, sessionOwnerPid: process.pid },
      );

      const state = await readSubagentTrackingState(cwd);
      assert.equal(state.sessions[childThreadId]?.leader_attested_at, undefined, 'child thread must not be attested as leader');
    } finally {
      if (priorEnv.NOMX_SESSION_ID !== undefined) process.env.NOMX_SESSION_ID = priorEnv.NOMX_SESSION_ID;
      if (priorEnv.CODEX_SESSION_ID !== undefined) process.env.CODEX_SESSION_ID = priorEnv.CODEX_SESSION_ID;
      if (priorEnv.SESSION_ID !== undefined) process.env.SESSION_ID = priorEnv.SESSION_ID;
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('never bootstraps a leader from a PreToolUse carrying a malformed/blank thread_spawn carrier', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nomx-3181-e2e-malformed-spawn-'));
    const priorEnv = { NOMX_SESSION_ID: process.env.NOMX_SESSION_ID, CODEX_SESSION_ID: process.env.CODEX_SESSION_ID, SESSION_ID: process.env.SESSION_ID };
    try {
      delete process.env.NOMX_SESSION_ID;
      delete process.env.CODEX_SESSION_ID;
      delete process.env.SESSION_ID;
      const childThreadId = 'codex-native-malformed-spawn';
      // Present-but-malformed thread_spawn carrier (blank parent id) is still child
      // provenance and must veto leader bootstrap: no pointer, no attestation.
      await dispatchCodexNativeHook(
        {
          hook_event_name: 'PreToolUse',
          cwd,
          session_id: childThreadId,
          thread_id: childThreadId,
          tool_name: 'Bash',
          tool_use_id: 'tool-malformed-spawn',
          source: { subagent: { thread_spawn: { parent_thread_id: '' } } },
          tool_input: { command: 'nomx ralplan role-intent write --role architect --parent-thread "$CODEX_THREAD_ID" --json' },
        },
        { cwd, sessionOwnerPid: process.pid },
      );
      const state = await readSubagentTrackingState(cwd);
      assert.equal(state.sessions[childThreadId]?.leader_attested_at, undefined, 'malformed thread_spawn must not attest as leader');
    } finally {
      if (priorEnv.NOMX_SESSION_ID !== undefined) process.env.NOMX_SESSION_ID = priorEnv.NOMX_SESSION_ID;
      if (priorEnv.CODEX_SESSION_ID !== undefined) process.env.CODEX_SESSION_ID = priorEnv.CODEX_SESSION_ID;
      if (priorEnv.SESSION_ID !== undefined) process.env.SESSION_ID = priorEnv.SESSION_ID;
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('never bootstraps a leader from a PreToolUse carrying an explicit non-installed agent_role', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nomx-3181-e2e-unknown-role-'));
    const priorEnv = { NOMX_SESSION_ID: process.env.NOMX_SESSION_ID, CODEX_SESSION_ID: process.env.CODEX_SESSION_ID, SESSION_ID: process.env.SESSION_ID };
    try {
      delete process.env.NOMX_SESSION_ID;
      delete process.env.CODEX_SESSION_ID;
      delete process.env.SESSION_ID;
      const childThreadId = 'codex-native-unknown-role';
      // An explicit but non-installed agent role is still role provenance and must veto
      // leader bootstrap even though it does not resolve to an installed NOMX agent.
      await dispatchCodexNativeHook(
        {
          hook_event_name: 'PreToolUse',
          cwd,
          session_id: childThreadId,
          thread_id: childThreadId,
          agent_role: 'collaboration-child',
          tool_name: 'Bash',
          tool_use_id: 'tool-unknown-role',
          tool_input: { command: 'nomx ralplan role-intent write --role architect --parent-thread "$CODEX_THREAD_ID" --json' },
        },
        { cwd, sessionOwnerPid: process.pid },
      );
      const state = await readSubagentTrackingState(cwd);
      assert.equal(state.sessions[childThreadId]?.leader_attested_at, undefined, 'explicit non-installed agent_role must not attest as leader');
    } finally {
      if (priorEnv.NOMX_SESSION_ID !== undefined) process.env.NOMX_SESSION_ID = priorEnv.NOMX_SESSION_ID;
      if (priorEnv.CODEX_SESSION_ID !== undefined) process.env.CODEX_SESSION_ID = priorEnv.CODEX_SESSION_ID;
      if (priorEnv.SESSION_ID !== undefined) process.env.SESSION_ID = priorEnv.SESSION_ID;
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
