import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getPackageRoot } from "../utils/package.js";

type PostinstallStatus =
  | "noop-local"
  | "noop-missing-version"
  | "hinted";

export interface PostinstallResult {
  status: PostinstallStatus;
  version: string | null;
}

interface PostinstallDependencies {
  env: NodeJS.ProcessEnv;
  getCurrentVersion: () => Promise<string | null>;
  log: (message: string) => void;
}

function stripLeadingV(version: string): string {
  return version.trim().replace(/^v/i, "");
}

function isTruthyEnv(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

export function isGlobalInstallLifecycle(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyEnv(env.npm_config_global) || env.npm_config_location === "global";
}

async function getCurrentVersion(): Promise<string | null> {
  try {
    const packageJsonPath = join(getPackageRoot(), "package.json");
    const content = await readFile(packageJsonPath, "utf-8");
    const parsed = JSON.parse(content) as { version?: string };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

const defaultDependencies: PostinstallDependencies = {
  env: process.env,
  getCurrentVersion,
  log: (message) => console.log(message),
};

export async function runPostinstall(
  dependencies: Partial<PostinstallDependencies> = {},
): Promise<PostinstallResult> {
  const resolved = { ...defaultDependencies, ...dependencies };
  const { env } = resolved;

  if (!isGlobalInstallLifecycle(env)) {
    return { status: "noop-local", version: null };
  }

  const currentVersion = await resolved.getCurrentVersion();
  if (!currentVersion) {
    return { status: "noop-missing-version", version: null };
  }

  const currentStampVersion = stripLeadingV(currentVersion);
  resolved.log(
    `[nomx] Installed NOMX v${currentStampVersion}. Setup is explicit opt-in; run \`nomx setup\` when you're ready.`,
  );
  return { status: "hinted", version: currentStampVersion };
}

export async function main(): Promise<void> {
  await runPostinstall();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.warn(
      `[nomx] Postinstall hint skipped after a non-fatal error: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}
