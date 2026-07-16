export const OMX_NOTIFY_TEMP_ENV = 'OMX_NOTIFY_TEMP';
export const OMX_NOTIFY_TEMP_CONTRACT_ENV = 'OMX_NOTIFY_TEMP_CONTRACT';

export type NotifyTempSource = 'none' | 'cli' | 'env' | 'providers';

export interface NotifyTempContract {
  active: boolean;
  selectors: string[];
  canonicalSelectors: string[];
  warnings: string[];
  source: NotifyTempSource;
}

export interface ParseNotifyTempContractResult {
  contract: NotifyTempContract;
  passthroughArgs: string[];
}

function toUnique(values: string[]): string[] {
  return [...new Set(values)];
}

export function parseNotifyTempContractFromArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): ParseNotifyTempContractResult {
  const passthroughArgs: string[] = [];
  const selectors: string[] = [];
  const warnings: string[] = [];
  let cliActivated = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--notify-temp') {
      cliActivated = true;
      continue;
    }

    if (arg === '--discord' || arg === '--slack' || arg === '--telegram') {
      selectors.push(arg.slice(2));
      continue;
    }

    passthroughArgs.push(arg);
  }

  const envActivated = env[OMX_NOTIFY_TEMP_ENV] === '1';
  const canonicalSelectors = toUnique(selectors);
  const providerActivated = canonicalSelectors.length > 0;
  const active = cliActivated || envActivated || providerActivated;

  if (providerActivated && !cliActivated && !envActivated) {
    warnings.push('notify temp: provider selectors imply temp mode (auto-activated)');
  }

  let source: NotifyTempSource = 'none';
  if (cliActivated) source = 'cli';
  else if (envActivated) source = 'env';
  else if (providerActivated) source = 'providers';

  return {
    contract: {
      active,
      selectors: [...selectors],
      canonicalSelectors,
      warnings,
      source,
    },
    passthroughArgs,
  };
}

export function serializeNotifyTempContract(contract: NotifyTempContract): string {
  return JSON.stringify(contract);
}


export function isNotifyTempEnvActive(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[OMX_NOTIFY_TEMP_ENV] === '1';
}

export function readNotifyTempContractFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): NotifyTempContract | null {
  const raw = env[OMX_NOTIFY_TEMP_CONTRACT_ENV];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<NotifyTempContract>;
    if (
      typeof parsed.active !== 'boolean'
      || !Array.isArray(parsed.selectors)
      || !Array.isArray(parsed.canonicalSelectors)
      || !Array.isArray(parsed.warnings)
      || typeof parsed.source !== 'string'
    ) {
      return null;
    }
    return {
      active: parsed.active,
      selectors: parsed.selectors.filter((entry): entry is string => typeof entry === 'string'),
      canonicalSelectors: parsed.canonicalSelectors.filter((entry): entry is string => typeof entry === 'string'),
      warnings: parsed.warnings.filter((entry): entry is string => typeof entry === 'string'),
      source: parsed.source as NotifyTempSource,
    };
  } catch {
    return null;
  }
}

export function getTempBuiltinSelectors(contract: NotifyTempContract | null): Set<string> {
  if (!contract?.active) return new Set<string>();
  return new Set(
    contract.canonicalSelectors.filter((selector) =>
      selector === 'discord' || selector === 'slack' || selector === 'telegram'),
  );
}
