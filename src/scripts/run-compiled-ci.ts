import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const SOURCE_CHECKOUT_SENTINELS = [
  "src/catalog/manifest.json",
  "templates/catalog-manifest.json",
  ".github/workflows/ci.yml",
] as const;

const INSTALLED_PACKAGE_CLI_SMOKE_COMMANDS = [
  ["--help"],
  ["version"],
  ["notepad", "--help"],
  ["project-memory", "--help"],
  ["trace", "--help"],
  ["code-intel", "--help"],
] as const;

function npmBin(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, [...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OMX_AUTO_UPDATE: "0",
      OMX_NOTIFY_FALLBACK: "0",
      OMX_HOOK_DERIVED_SIGNALS: "0",
    },
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function isSourceCheckout(): boolean {
  return SOURCE_CHECKOUT_SENTINELS.every((sentinel) =>
    existsSync(join(process.cwd(), sentinel)),
  );
}

function runSourceCheckoutGate(): void {
  run(npmBin(), ["run", "verify:native-agents"]);
  run(npmBin(), ["run", "verify:plugin-bundle"]);
  run(npmBin(), ["run", "test:node"]);
  run(process.execPath, ["dist/scripts/sync-catalog.js", "--check"]);
}

function runInstalledPackageGate(): void {
  run(npmBin(), ["run", "verify:native-agents"]);
  run(npmBin(), ["run", "verify:plugin-bundle"]);
  for (const argv of INSTALLED_PACKAGE_CLI_SMOKE_COMMANDS) {
    run(process.execPath, ["dist/cli/nomx.js", ...argv]);
  }
}

try {
  if (isSourceCheckout()) {
    runSourceCheckoutGate();
  } else {
    runInstalledPackageGate();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
