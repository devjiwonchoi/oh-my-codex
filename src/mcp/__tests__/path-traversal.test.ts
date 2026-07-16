import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('MCP state tools path traversal prevention', () => {
  process.env.NOMX_STATE_SERVER_DISABLE_AUTO_START = '1';

  it('rejects invalid workingDirectory inputs containing NUL bytes', async () => {
    const { handleStateToolCall } = await import('../state-server.js');
    const resp = await handleStateToolCall({
      params: {
        name: 'state_read',
        arguments: { mode: 'ralph', workingDirectory: 'bad\0path' },
      },
    });
    assert.equal(resp.isError, true);
    const body = JSON.parse(resp.content[0]?.text ?? '{}') as { error?: string };
    assert.match(body.error || '', /NUL byte/);
  });

  it('rejects traversal in mode for state_write', async () => {
    const { handleStateToolCall } = await import('../state-server.js');
    const wd = await mkdtemp(join(tmpdir(), 'nomx-traversal-'));
    try {
      const resp = await handleStateToolCall({
        params: {
          name: 'state_write',
          arguments: {
            mode: '../../outside',
            state: { active: true },
            workingDirectory: wd,
          },
        },
      });
      assert.equal(resp.isError, true);
      const body = JSON.parse(resp.content[0]?.text ?? '{}') as { error?: string };
      assert.ok(typeof body.error === 'string' && body.error.length > 0);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('rejects unsupported mode names for state_read', async () => {
    const { handleStateToolCall } = await import('../state-server.js');
    const wd = await mkdtemp(join(tmpdir(), 'nomx-traversal-'));
    try {
      const resp = await handleStateToolCall({
        params: {
          name: 'state_read',
          arguments: {
            mode: 'custom_mode',
            workingDirectory: wd,
          },
        },
      });
      assert.equal(resp.isError, true);
      const body = JSON.parse(resp.content[0]?.text ?? '{}') as { error?: string };
      assert.ok(typeof body.error === 'string' && body.error.includes('mode must be one of'));
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

});
