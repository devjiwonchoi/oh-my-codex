import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, afterEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';

import { getProxyForUrl, noProxyMatches, requestJson, type ProxyEnv } from '../http-client.js';

describe('proxy env resolution', () => {
  it('uses scheme-specific lowercase proxy before uppercase and ALL_PROXY', () => {
    const env: ProxyEnv = {
      HTTPS_PROXY: 'http://upper.example:8080',
      https_proxy: 'http://lower.example:8080',
      ALL_PROXY: 'http://all.example:8080',
    };
    assert.equal(getProxyForUrl('https://discord.com/api/webhooks/1/abc', env)?.url.hostname, 'lower.example');
  });

  it('falls back to ALL_PROXY for https when no scheme proxy exists', () => {
    const env: ProxyEnv = { ALL_PROXY: 'http://all.example:8080' };
    assert.equal(getProxyForUrl('https://hooks.slack.com/services/T/B/C', env)?.url.hostname, 'all.example');
  });

  it('ignores blank scheme-specific proxy values and trims the fallback', () => {
    const env: ProxyEnv = {
      https_proxy: '   ',
      ALL_PROXY: '  http://all.example:8080  ',
    };
    const proxy = getProxyForUrl('https://hooks.slack.com/services/T/B/C', env);
    assert.equal(proxy?.url.hostname, 'all.example');
    assert.equal(proxy?.url.port, '8080');
  });

  it('bypasses proxy when NO_PROXY matches exact host, suffix, port, or wildcard', () => {
    assert.equal(noProxyMatches(new URL('https://api.telegram.org/bot/sendMessage'), 'api.telegram.org'), true);
    assert.equal(noProxyMatches(new URL('https://sub.example.com/hook'), '.example.com'), true);
    assert.equal(noProxyMatches(new URL('https://example.com:8443/hook'), 'example.com:8443'), true);
    assert.equal(noProxyMatches(new URL('https://anything.invalid/hook'), '*'), true);
  });

  it('does not bypass when NO_PROXY host port differs', () => {
    assert.equal(noProxyMatches(new URL('https://example.com:443/hook'), 'example.com:8443'), false);
  });
});

describe('requestJson proxy routing', () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function listen(t: TestContext, handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> } | null> {
    const server = createServer(handler);
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM' || (error as NodeJS.ErrnoException).code === 'EACCES') {
        t.skip('local TCP listeners are unavailable in this environment');
        return null;
      }
      throw error;
    }
    const address = server.address();
    assert.equal(typeof address, 'object');
    assert.ok(address);
    const { port } = address as AddressInfo;
    const handle = {
      url: `http://127.0.0.1:${port}`,
      close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    };
    servers.push(handle);
    return handle;
  }

  it('sends HTTP requests through HTTP_PROXY when configured', async (t) => {
    const seen: string[] = [];
    const target = await listen(t, (_req, res) => {
      res.statusCode = 500;
      res.end('direct path should not be used');
    });
    if (!target) return;
    const proxy = await listen(t, (req, res) => {
      seen.push(req.url ?? '');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });

    if (!proxy) return;
    const response = await requestJson(`${target.url}/notify?x=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
      timeoutMs: 1000,
    }, { HTTP_PROXY: proxy.url });

    assert.equal(response.ok, true);
    assert.deepEqual(seen, [`${target.url}/notify?x=1`]);
  });

  it('bypasses proxy when NO_PROXY matches the target host', async (t) => {
    let directHits = 0;
    let proxyHits = 0;
    const target = await listen(t, (_req, res) => {
      directHits += 1;
      res.end('ok');
    });
    if (!target) return;
    const proxy = await listen(t, (_req, res) => {
      proxyHits += 1;
      res.statusCode = 502;
      res.end('proxy should not be used');
    });

    if (!proxy) return;
    const response = await requestJson(`${target.url}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      timeoutMs: 1000,
    }, { HTTP_PROXY: proxy.url, NO_PROXY: '127.0.0.1' });

    assert.equal(response.ok, true);
    assert.equal(directHits, 1);
    assert.equal(proxyHits, 0);
  });
});
