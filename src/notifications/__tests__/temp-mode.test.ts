import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getNotificationConfig } from '../config.js';

const ENV_KEYS = [
  'CODEX_HOME',
  'NOMX_NOTIFY_TEMP',
  'NOMX_NOTIFY_TEMP_CONTRACT',
  'NOMX_NOTIFY_PROFILE',
  'NOMX_DISCORD_WEBHOOK_URL',
  'NOMX_DISCORD_NOTIFIER_BOT_TOKEN',
  'NOMX_DISCORD_NOTIFIER_CHANNEL',
  'NOMX_TELEGRAM_BOT_TOKEN',
  'NOMX_TELEGRAM_CHAT_ID',
  'NOMX_SLACK_WEBHOOK_URL',
] as const;

let tempCodexHome: string;

async function writeCodexConfig(contents: unknown): Promise<void> {
  await mkdir(tempCodexHome, { recursive: true });
  await writeFile(join(tempCodexHome, '.nomx-config.json'), JSON.stringify(contents, null, 2));
}

function clearEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

describe('notification temp mode', () => {
  beforeEach(async () => {
    clearEnv();
    tempCodexHome = await mkdtemp(join(tmpdir(), 'nomx-notify-temp-'));
    process.env.CODEX_HOME = tempCodexHome;
  });

  afterEach(async () => {
    clearEnv();
    if (tempCodexHome) {
      await rm(tempCodexHome, { recursive: true, force: true });
    }
  });

  it('temp contract bypasses persistent file/profile routing', async () => {
    await writeCodexConfig({
      notifications: {
        enabled: true,
        defaultProfile: 'file-profile',
        profiles: {
          'file-profile': {
            enabled: true,
            discord: { enabled: true, webhookUrl: 'https://discord.com/api/webhooks/file' },
          },
        },
      },
    });
    process.env.NOMX_NOTIFY_PROFILE = 'file-profile';
    process.env.NOMX_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/temp-only';
    process.env.NOMX_NOTIFY_TEMP_CONTRACT = JSON.stringify({
      active: true,
      selectors: ['slack'],
      canonicalSelectors: ['slack'],
      warnings: [],
      source: 'cli',
    });

    const config = getNotificationConfig();
    assert.ok(config);
    assert.equal(config.enabled, true);
    assert.equal(config.slack?.enabled, true);
    assert.equal(config.discord, undefined);
  });

  it('temp contract with no valid configured provider disables dispatch config', () => {
    process.env.NOMX_NOTIFY_TEMP_CONTRACT = JSON.stringify({
      active: true,
      selectors: ['telegram'],
      canonicalSelectors: ['telegram'],
      warnings: [],
      source: 'cli',
    });

    const config = getNotificationConfig();
    assert.ok(config);
    assert.equal(config.enabled, false);
  });

});
