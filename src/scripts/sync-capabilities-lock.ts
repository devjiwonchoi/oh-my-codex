#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

interface ToolContract {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
	server: string;
	enabled: boolean;
}

interface DigestEntry {
	path: string;
	digest: string;
}

interface FixtureContract {
	id: string;
	prompt_id: string;
	required: boolean;
	allowed_tools: string[];
	expected_tool?: string;
	no_tool_calls?: boolean;
}

const ROOT = process.cwd();
const LOCK_PATH = join(ROOT, "nomx-capabilities.lock.json");
const CHECK_ONLY = process.argv.includes("--check");

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJson);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => [key, sortJson(child)]),
	);
}

function canonicalStringify(value: unknown): string {
	return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

async function collectDigestEntries(
	roots: string[],
	suffixes: string[],
): Promise<DigestEntry[]> {
	const entries: DigestEntry[] = [];

	async function walk(directory: string): Promise<void> {
		let children: import("node:fs").Dirent[];
		try {
			children = await readdir(directory, { withFileTypes: true });
		} catch {
			return;
		}

		for (const child of children) {
			const path = join(directory, child.name);
			if (child.isDirectory()) {
				await walk(path);
				continue;
			}
			if (
				!suffixes.some(
					(suffix) => child.name === suffix || child.name.endsWith(suffix),
				)
			) {
				continue;
			}
			entries.push({
				path: relative(ROOT, path).replaceAll("\\", "/"),
				digest: sha256(await readFile(path, "utf8")),
			});
		}
	}

	for (const root of roots) await walk(join(ROOT, root));
	return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function collectConfiguredTools(): Promise<{
	digest: string;
	tools: ToolContract[];
	disabled_first_party_servers: string[];
	external_servers: never[];
}> {
	const disableKey = "NOMX_MCP_SERVER_DISABLE_AUTO_START";
	const previousDisable = process.env[disableKey];
	process.env[disableKey] = "1";

	try {
		const [state, memory, codeIntel, trace, hermes] = await Promise.all([
			import("../mcp/state-server.js"),
			import("../mcp/memory-server.js"),
			import("../mcp/code-intel-server.js"),
			import("../mcp/trace-server.js"),
			import("../mcp/hermes-server.js"),
		]);
		const builders = new Map<
			string,
			() => Array<{
				name: string;
				description?: string;
				inputSchema?: Record<string, unknown>;
			}>
		>([
			["state", state.buildStateServerTools],
			["memory", memory.buildMemoryServerTools],
			["code_intel", codeIntel.buildCodeIntelServerTools],
			["trace", trace.buildTraceServerTools],
			["hermes", hermes.buildHermesServerTools],
		]);

		const tools = [...builders.entries()]
			.flatMap(([server, build]) =>
				build().map((tool) => ({
					name: tool.name,
					...(tool.description ? { description: tool.description } : {}),
					...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
					server,
					enabled: true,
				})),
			)
			.sort((left, right) =>
				`${left.server}:${left.name}`.localeCompare(`${right.server}:${right.name}`),
			);
		const digestInput = {
			tools,
			disabled_first_party_servers: [] as string[],
			external_servers: [] as never[],
		};
		return { ...digestInput, digest: sha256(canonicalStringify(digestInput)) };
	} finally {
		if (previousDisable === undefined) delete process.env[disableKey];
		else process.env[disableKey] = previousDisable;
	}
}

function buildFixtureContracts(allowedTools: string[]): FixtureContract[] {
	const sortedAllowed = [...allowedTools].sort();
	const choose = (preferred: string, fallback: string): string =>
		sortedAllowed.includes(preferred) ? preferred : fallback;
	return [
		{
			id: "project-memory-write-required-arg",
			prompt_id: "missing-required-arg",
			required: true,
			allowed_tools: sortedAllowed,
			expected_tool: choose(
				"project_memory_write",
				sortedAllowed[0] ?? "project_memory_write",
			),
		},
		{
			id: "project-memory-read-known-tool",
			prompt_id: "known-tool-success",
			required: true,
			allowed_tools: sortedAllowed,
			expected_tool: choose(
				"project_memory_read",
				sortedAllowed[0] ?? "project_memory_read",
			),
		},
		{
			id: "tool-restraint-no-call",
			prompt_id: "tool-restraint",
			required: true,
			allowed_tools: [],
			no_tool_calls: true,
		},
	];
}

async function buildCapabilitiesLock(): Promise<Record<string, unknown>> {
	const [configuredTools, skills, agents] = await Promise.all([
		collectConfiguredTools(),
		collectDigestEntries(
			["skills"],
			["SKILL.md", "catalog.json", "metadata.json"],
		),
		collectDigestEntries(
			["prompts", join("templates", "model-instructions")],
			[".md", ".toml", ".json"],
		),
	]);
	const fixtures = buildFixtureContracts(
		configuredTools.tools.filter((tool) => tool.enabled).map((tool) => tool.name),
	);

	return {
		version: 1,
		kind: "nomx_capabilities_lock",
		surfaces: {
			configured_tools: configuredTools,
			skills: { digest: sha256(canonicalStringify(skills)), files: skills },
			agents: { digest: sha256(canonicalStringify(agents)), files: agents },
			fixtures: {
				digest: sha256(canonicalStringify(fixtures)),
				fixtures,
			},
		},
	};
}

async function main(): Promise<void> {
	const expected = canonicalStringify(await buildCapabilitiesLock());
	if (CHECK_ONLY) {
		const current = existsSync(LOCK_PATH)
			? await readFile(LOCK_PATH, "utf8")
			: "";
		if (current !== expected) {
			throw new Error(
				"capabilities_lock_drift: run npm run sync:capabilities-lock after changing packaged prompts, skills, or MCP schemas",
			);
		}
		console.log("capabilities lock check ok");
		return;
	}

	await writeFile(LOCK_PATH, expected, "utf8");
	console.log(`wrote ${LOCK_PATH}`);
}

await main();
