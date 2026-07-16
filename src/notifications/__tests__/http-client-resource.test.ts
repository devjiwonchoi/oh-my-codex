import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { requestJson } from '../http-client.js';

describe('HTTP client resource cleanup', () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it('destroys direct sockets on request timeout to avoid resource leaks', async (t) => {
    const originalFetch = globalThis.fetch;
    const sockets: Socket[] = [];
    const server = createServer((socket) => {
      sockets.push(socket);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM' || (error as NodeJS.ErrnoException).code === 'EACCES') {
        t.skip('local TCP listeners are unavailable in this environment');
        return;
      }
      throw error;
    }
    servers.push({ close: () => new Promise((resolve, reject) => {
      for (const socket of sockets) socket.destroy();
      server.close((error) => error ? reject(error) : resolve());
    }) });
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    try {
      // Force the Node http/https implementation so this test covers the
      // explicit timeout cleanup path rather than the platform fetch wrapper.
      (globalThis as { fetch?: typeof fetch }).fetch = undefined;
      await assert.rejects(
        () => requestJson(`http://127.0.0.1:${address.port}/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          timeoutMs: 20,
        }, {}),
        /Request timeout/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(sockets.length, 1);
  });
});
