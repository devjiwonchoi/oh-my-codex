import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { parse as parseToml } from "@iarna/toml";
import { resolveNamespaceEnvironment } from "../identity/index.js";

export const NOMX_LORE_COMMIT_GUARD_ENV = "NOMX_LORE_COMMIT_GUARD";

interface CodexLoreCommitGuardConfig {
	env?: Record<string, unknown>;
	shell_environment_policy?: { set?: Record<string, unknown> };
}

export function isLoreCommitGuardEnabled(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	try {
		const resolved = resolveNamespaceEnvironment({ suffix: "LORE_COMMIT_GUARD", kind: "boolean" }, env).value;
		return resolved === true;
	} catch {
		// This guard is opt-in. Invalid input must preserve the default-off
		// behavior rather than blocking an unrelated Codex launch.
		return false;
	}
}

function resolveCodexHome(env: NodeJS.ProcessEnv): string {
	const configured = env.CODEX_HOME?.trim();
	if (configured) return configured;

	const home = env.HOME?.trim() || homedir();
	return join(home, ".codex");
}

export function readConfiguredLoreCommitGuardValue(
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const configPath = join(resolveCodexHome(env), "config.toml");
	if (!existsSync(configPath)) return undefined;

	try {
		const parsed = parseToml(readFileSync(configPath, "utf-8")) as CodexLoreCommitGuardConfig;
		const configured = {
			...Object.fromEntries(Object.entries(parsed?.env ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
			...Object.fromEntries(Object.entries(parsed?.shell_environment_policy?.set ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
		};
		const value = resolveNamespaceEnvironment({ suffix: "LORE_COMMIT_GUARD", kind: "string" }, configured).value;
		return typeof value === "string" ? value : undefined;
	} catch {
		// Invalid config leaves the guard at its default-off behavior.
		return undefined;
	}
}
