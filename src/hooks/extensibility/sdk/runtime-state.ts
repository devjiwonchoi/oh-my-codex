import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import type {
  HookPluginNomxHudState,
  HookPluginNomxNotifyFallbackState,
  HookPluginNomxSessionState,
  HookPluginNomxUpdateCheckState,
  HookPluginSdk,
} from '../types.js';
import { nomxRootStateFilePath } from './paths.js';
import { getReadScopedStateFilePaths } from '../../../mcp/state-paths.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readNomxStateFile<T extends Record<string, unknown>>(
  path: string,
  normalize?: (value: Record<string, unknown>) => T | null,
): Promise<T | null> {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as unknown;
    if (!isRecord(parsed)) return null;
    return normalize ? normalize(parsed) : parsed as T;
  } catch {
    return null;
  }
}

function normalizeSessionState(value: Record<string, unknown>): HookPluginNomxSessionState | null {
  return typeof value.session_id === 'string' && value.session_id.trim()
    ? value as HookPluginNomxSessionState
    : null;
}

export function createHookPluginNomxApi(cwd: string): HookPluginSdk['nomx'] {
  return {
    session: {
      read: () => readNomxStateFile<HookPluginNomxSessionState>(
        nomxRootStateFilePath(cwd, 'session.json'),
        normalizeSessionState,
      ),
    },
    hud: {
      read: async () => {
        const [hudStatePath] = await getReadScopedStateFilePaths('hud-state.json', cwd, undefined, {
          rootFallback: false,
        });
        return readNomxStateFile<HookPluginNomxHudState>(hudStatePath);
      },
    },
    notifyFallback: {
      read: () => readNomxStateFile<HookPluginNomxNotifyFallbackState>(
        nomxRootStateFilePath(cwd, 'notify-fallback-state.json'),
      ),
    },
    updateCheck: {
      read: () => readNomxStateFile<HookPluginNomxUpdateCheckState>(
        nomxRootStateFilePath(cwd, 'update-check.json'),
      ),
    },
  };
}
