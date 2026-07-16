import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { withModeRuntimeContext } from '../mode-state-context.js';

describe('withModeRuntimeContext', () => {
  it('returns workflow state without adding terminal metadata', () => {
    const next = { active: true, current_phase: 'planning' };
    assert.deepEqual(withModeRuntimeContext({}, next), next);
  });
});
