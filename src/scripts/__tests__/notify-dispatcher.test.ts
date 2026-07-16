import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync } from "node:fs";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function runDispatcher(
	metadataPath: string,
	payload: Record<string, unknown> = { type: "test" },
	env: NodeJS.ProcessEnv = {},
): void {
	const dispatcherScript = join(process.cwd(), "dist", "scripts", "notify-dispatcher.js");
	const result = spawnSync(
		process.execPath,
		[dispatcherScript, "--metadata", metadataPath, JSON.stringify(payload)],
		{ encoding: "utf-8", env: { ...process.env, ...env }, windowsHide: true },
	);
	assert.equal(result.status, 0, result.stderr || result.stdout);
}

describe("notify dispatcher turn-ended storm guard", () => {
	it("coalesces rapid turn-ended dispatcher callbacks to one NOMX notify run", () => {
		const wd = mkdtempSync(join(tmpdir(), "nomx-notify-dispatcher-rapid-"));
		try {
			const nomxMarker = join(wd, "nomx-ran");
			const nomxHook = join(wd, "current-notify-hook.js");
			writeFileSync(nomxHook, `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(nomxMarker)}, "nomx|");\n`);
			const metadataPath = join(wd, "notify-dispatch.json");
			writeFileSync(metadataPath, JSON.stringify({ managedBy: "nomx", version: 1, nomxNotify: [process.execPath, nomxHook] }));

			for (let index = 0; index < 10; index += 1) {
				runDispatcher(metadataPath, { type: "agent-turn-complete", thread_id: "desktop-thread", turn_id: `queued-${index}` });
			}

			assert.equal(readFileSync(nomxMarker, "utf-8"), "nomx|");
		} finally {
			rmSync(wd, { recursive: true, force: true });
		}
	});

	it("allows separate turn-ended identities to dispatch independently", () => {
		const wd = mkdtempSync(join(tmpdir(), "nomx-notify-dispatcher-identities-"));
		try {
			const nomxMarker = join(wd, "nomx-ran");
			const nomxHook = join(wd, "current-notify-hook.js");
			writeFileSync(nomxHook, `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(nomxMarker)}, "nomx|");\n`);
			const metadataPath = join(wd, "notify-dispatch.json");
			writeFileSync(metadataPath, JSON.stringify({ managedBy: "nomx", version: 1, nomxNotify: [process.execPath, nomxHook] }));

			runDispatcher(metadataPath, { type: "agent-turn-complete", thread_id: "desktop-thread-a", turn_id: "queued-a" });
			runDispatcher(metadataPath, { type: "agent-turn-complete", thread_id: "desktop-thread-b", turn_id: "queued-b" });

			assert.equal(readFileSync(nomxMarker, "utf-8"), "nomx|nomx|");
		} finally {
			rmSync(wd, { recursive: true, force: true });
		}
	});

	it("coalesces same-identity turn-ended callbacks after a slow notify hook completes", () => {
		const wd = mkdtempSync(join(tmpdir(), "nomx-notify-dispatcher-slow-"));
		try {
			const nomxMarker = join(wd, "nomx-ran");
			const nomxHook = join(wd, "current-notify-hook.js");
			writeFileSync(nomxHook, `import { appendFileSync } from "node:fs"; await new Promise((resolve) => setTimeout(resolve, 1500)); appendFileSync(${JSON.stringify(nomxMarker)}, "nomx|");\n`);
			const metadataPath = join(wd, "notify-dispatch.json");
			writeFileSync(metadataPath, JSON.stringify({ managedBy: "nomx", version: 1, nomxNotify: [process.execPath, nomxHook] }));
			const env = { NOMX_NOTIFY_DISPATCH_MIN_INTERVAL_MS: "1000" };

			runDispatcher(metadataPath, { type: "agent-turn-complete", thread_id: "slow-thread", turn_id: "queued-a" }, env);
			runDispatcher(metadataPath, { type: "agent-turn-complete", thread_id: "slow-thread", turn_id: "queued-b" }, env);

			assert.equal(readFileSync(nomxMarker, "utf-8"), "nomx|");
		} finally {
			rmSync(wd, { recursive: true, force: true });
		}
	});

	it("prunes expired turn-ended identity guard state", () => {
		const wd = mkdtempSync(join(tmpdir(), "nomx-notify-dispatcher-prune-"));
		try {
			const nomxMarker = join(wd, "nomx-ran");
			const nomxHook = join(wd, "current-notify-hook.js");
			writeFileSync(nomxHook, `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(nomxMarker)}, "nomx|");\n`);
			const metadataPath = join(wd, "notify-dispatch.json");
			const guardPath = join(wd, "notify-dispatch.guard.json");
			writeFileSync(metadataPath, JSON.stringify({ managedBy: "nomx", version: 1, nomxNotify: [process.execPath, nomxHook] }));
			writeFileSync(guardPath, JSON.stringify({
				lastDispatchByIdentity: {
					"thread_id:expired": Date.now() - 11 * 60_000,
					"thread_id:recent": Date.now(),
				},
			}));

			runDispatcher(metadataPath, { type: "agent-turn-complete", thread_id: "fresh-thread", turn_id: "queued-fresh" });

			const guard = JSON.parse(readFileSync(guardPath, "utf-8"));
			assert.equal("thread_id:expired" in guard.lastDispatchByIdentity, false);
			assert.equal(typeof guard.lastDispatchByIdentity["thread_id:recent"], "number");
			assert.equal(typeof guard.lastDispatchByIdentity["thread_id:fresh-thread"], "number");
		} finally {
			rmSync(wd, { recursive: true, force: true });
		}
	});

	it("drops stale turn-ended dispatcher callbacks before spawning notify hooks", () => {
		const wd = mkdtempSync(join(tmpdir(), "nomx-notify-dispatcher-stale-event-"));
		try {
			const nomxMarker = join(wd, "nomx-ran");
			const nomxHook = join(wd, "current-notify-hook.js");
			writeFileSync(nomxHook, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(nomxMarker)}, "ran");\n`);
			const metadataPath = join(wd, "notify-dispatch.json");
			writeFileSync(metadataPath, JSON.stringify({ managedBy: "nomx", version: 1, nomxNotify: [process.execPath, nomxHook] }));

			runDispatcher(metadataPath, {
				type: "agent-turn-complete",
				timestamp: new Date(Date.now() - 10 * 60_000).toISOString(),
				thread_id: "desktop-thread",
				turn_id: "stale-turn",
			});

			assert.equal(existsSync(nomxMarker), false);
		} finally {
			rmSync(wd, { recursive: true, force: true });
		}
	});

	it("preserves normal non-turn notify dispatches", () => {
		const wd = mkdtempSync(join(tmpdir(), "nomx-notify-dispatcher-normal-"));
		try {
			const nomxMarker = join(wd, "nomx-ran");
			const nomxHook = join(wd, "current-notify-hook.js");
			writeFileSync(nomxHook, `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(nomxMarker)}, "nomx|");\n`);
			const metadataPath = join(wd, "notify-dispatch.json");
			writeFileSync(metadataPath, JSON.stringify({ managedBy: "nomx", version: 1, nomxNotify: [process.execPath, nomxHook] }));

			runDispatcher(metadataPath, { type: "test", id: 1 });
			runDispatcher(metadataPath, { type: "test", id: 2 });

			assert.equal(readFileSync(nomxMarker, "utf-8"), "nomx|nomx|");
		} finally {
			rmSync(wd, { recursive: true, force: true });
		}
	});
});

describe("notify dispatcher previousNotify guard", () => {
	it("skips stale NOMX-managed previousNotify dispatcher entries", () => {
		const wd = mkdtempSync(join(tmpdir(), "nomx-notify-dispatcher-stale-"));
		try {
			const oldPkgScripts = join(wd, "global", "nomx", "dist", "scripts");
			mkdirSync(oldPkgScripts, { recursive: true });
			const stalePreviousMarker = join(wd, "stale-previous-ran");
			const nomxMarker = join(wd, "nomx-ran");
			const staleDispatcher = join(oldPkgScripts, "notify-dispatcher.js");
			const nomxHook = join(wd, "current-notify-hook.js");
			writeFileSync(staleDispatcher, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(stalePreviousMarker)}, "ran");\n`);
			writeFileSync(nomxHook, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(nomxMarker)}, "ran");\n`);
			const metadataPath = join(wd, "notify-dispatch.json");
			writeFileSync(
				metadataPath,
				JSON.stringify({
					managedBy: "nomx",
					version: 1,
					previousNotify: [process.execPath, staleDispatcher, "--metadata", metadataPath],
					nomxNotify: [process.execPath, nomxHook],
					dispatcherNotify: [
						process.execPath,
						join(process.cwd(), "dist", "scripts", "notify-dispatcher.js"),
						"--metadata",
						metadataPath,
					],
				}),
			);

			runDispatcher(metadataPath);

			assert.equal(existsSync(stalePreviousMarker), false);
			assert.equal(readFileSync(nomxMarker, "utf-8"), "ran");
		} finally {
			rmSync(wd, { recursive: true, force: true });
		}
	});

	it("skips stale NOMX-managed previousNotify dispatcher entries behind node flags", () => {
		const wd = mkdtempSync(join(tmpdir(), "nomx-notify-dispatcher-flagged-stale-"));
		try {
			const oldPkgScripts = join(wd, "global", "nomx", "dist", "scripts");
			mkdirSync(oldPkgScripts, { recursive: true });
			const stalePreviousMarker = join(wd, "stale-previous-ran");
			const nomxMarker = join(wd, "nomx-ran");
			const staleDispatcher = join(oldPkgScripts, "notify-dispatcher.js");
			const nomxHook = join(wd, "current-notify-hook.js");
			writeFileSync(staleDispatcher, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(stalePreviousMarker)}, "ran");\n`);
			writeFileSync(nomxHook, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(nomxMarker)}, "ran");\n`);
			const metadataPath = join(wd, "notify-dispatch.json");
			writeFileSync(
				metadataPath,
				JSON.stringify({
					managedBy: "nomx",
					version: 1,
					previousNotify: [
						process.execPath,
						"--no-warnings",
						staleDispatcher,
						"--metadata",
						metadataPath,
					],
					nomxNotify: [process.execPath, nomxHook],
				}),
			);

			runDispatcher(metadataPath);

			assert.equal(existsSync(stalePreviousMarker), false);
			assert.equal(readFileSync(nomxMarker, "utf-8"), "ran");
		} finally {
			rmSync(wd, { recursive: true, force: true });
		}
	});

	it("skips stale turn-ended wrappers whose previousNotify is an NOMX dispatcher", () => {
		const wd = mkdtempSync(join(tmpdir(), "nomx-notify-dispatcher-wrapper-"));
		try {
			const oldPkgScripts = join(wd, "global", "nomx", "dist", "scripts");
			mkdirSync(oldPkgScripts, { recursive: true });
			const stalePreviousMarker = join(wd, "stale-wrapper-ran");
			const nomxMarker = join(wd, "nomx-ran");
			const staleDispatcher = join(oldPkgScripts, "notify-dispatcher.js");
			const turnEndedWrapper = join(wd, "SkyComputerUseClient");
			const nomxHook = join(wd, "current-notify-hook.js");
			writeFileSync(
				turnEndedWrapper,
				`import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(stalePreviousMarker)}, "ran");\n`,
			);
			writeFileSync(nomxHook, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(nomxMarker)}, "ran");\n`);
			const metadataPath = join(wd, "notify-dispatch.json");
			writeFileSync(
				metadataPath,
				JSON.stringify({
					managedBy: "nomx",
					version: 1,
					previousNotify: [
						process.execPath,
						turnEndedWrapper,
						"turn-ended",
						"--previous-notify",
						JSON.stringify([
							process.execPath,
							staleDispatcher,
							"--metadata",
							metadataPath,
						]),
					],
					nomxNotify: [process.execPath, nomxHook],
				}),
			);

			runDispatcher(metadataPath);

			assert.equal(existsSync(stalePreviousMarker), false);
			assert.equal(readFileSync(nomxMarker, "utf-8"), "ran");
		} finally {
			rmSync(wd, { recursive: true, force: true });
		}
	});

	it("skips stale turn-ended wrappers whose previousNotify text is an NOMX hook", () => {
		const wd = mkdtempSync(join(tmpdir(), "nomx-notify-dispatcher-wrapper-text-"));
		try {
			const oldPkgScripts = join(wd, "global", "nomx", "dist", "scripts");
			mkdirSync(oldPkgScripts, { recursive: true });
			const stalePreviousMarker = join(wd, "stale-wrapper-ran");
			const nomxMarker = join(wd, "nomx-ran");
			const staleHook = join(oldPkgScripts, "notify-hook.js");
			const turnEndedWrapper = join(wd, "SkyComputerUseClient");
			const nomxHook = join(wd, "current-notify-hook.js");
			writeFileSync(
				turnEndedWrapper,
				`import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(stalePreviousMarker)}, "ran");\n`,
			);
			writeFileSync(nomxHook, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(nomxMarker)}, "ran");\n`);
			const metadataPath = join(wd, "notify-dispatch.json");
			writeFileSync(
				metadataPath,
				JSON.stringify({
					managedBy: "nomx",
					version: 1,
					previousNotify: [
						process.execPath,
						turnEndedWrapper,
						"turn-ended",
						`--previous-notify=node ${staleHook}`,
					],
					nomxNotify: [process.execPath, nomxHook],
				}),
			);

			runDispatcher(metadataPath);

			assert.equal(existsSync(stalePreviousMarker), false);
			assert.equal(readFileSync(nomxMarker, "utf-8"), "ran");
		} finally {
			rmSync(wd, { recursive: true, force: true });
		}
	});

	it("skips SkyComputerUseClient wrappers with quoted nested previousNotify self-references", () => {
		const wd = mkdtempSync(join(tmpdir(), "nomx-notify-dispatcher-nested-wrapper-"));
		try {
			const oldPkgScripts = join(wd, "global", "nomx", "dist", "scripts");
			mkdirSync(oldPkgScripts, { recursive: true });
			const stalePreviousMarker = join(wd, "nested-wrapper-ran");
			const nomxMarker = join(wd, "nomx-ran");
			const staleDispatcher = join(oldPkgScripts, "notify-dispatcher.js");
			const turnEndedWrapper = join(wd, "SkyComputerUseClient");
			const nomxHook = join(wd, "current-notify-hook.js");
			writeFileSync(
				turnEndedWrapper,
				`import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(stalePreviousMarker)}, "ran");\n`,
			);
			writeFileSync(nomxHook, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(nomxMarker)}, "ran");\n`);
			const metadataPath = join(wd, "notify-dispatch.json");
			const nestedSelfReference = JSON.stringify([
				process.execPath,
				turnEndedWrapper,
				"turn-ended",
				"--previous-notify",
				JSON.stringify([process.execPath, staleDispatcher, "--metadata", metadataPath]),
			]);
			writeFileSync(
				metadataPath,
				JSON.stringify({
					managedBy: "nomx",
					version: 1,
					previousNotify: [
						process.execPath,
						turnEndedWrapper,
						"turn-ended",
						"--previous-notify",
						JSON.stringify(nestedSelfReference),
					],
					nomxNotify: [process.execPath, nomxHook],
				}),
			);

			runDispatcher(metadataPath);

			assert.equal(existsSync(stalePreviousMarker), false);
			assert.equal(readFileSync(nomxMarker, "utf-8"), "ran");
		} finally {
			rmSync(wd, { recursive: true, force: true });
		}
	});

	it("skips wrapper metadata objects with encoded NOMX dispatcher payloads", () => {
		const wd = mkdtempSync(join(tmpdir(), "nomx-notify-dispatcher-object-wrapper-"));
		try {
			const oldPkgScripts = join(wd, "global", "nomx", "dist", "scripts");
			mkdirSync(oldPkgScripts, { recursive: true });
			const stalePreviousMarker = join(wd, "object-wrapper-ran");
			const nomxMarker = join(wd, "nomx-ran");
			const staleDispatcher = join(oldPkgScripts, "notify-dispatcher.js");
			const turnEndedWrapper = join(wd, "SkyComputerUseClient");
			const nomxHook = join(wd, "current-notify-hook.js");
			writeFileSync(
				turnEndedWrapper,
				`import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(stalePreviousMarker)}, "ran");\n`,
			);
			writeFileSync(nomxHook, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(nomxMarker)}, "ran");\n`);
			const metadataPath = join(wd, "notify-dispatch.json");
			writeFileSync(
				metadataPath,
				JSON.stringify({
					managedBy: "nomx",
					version: 1,
					previousNotify: [
						process.execPath,
						turnEndedWrapper,
						"turn-ended",
						`--previous-notify=${JSON.stringify({ previousNotify: JSON.stringify([process.execPath, staleDispatcher]) })}`,
					],
					nomxNotify: [process.execPath, nomxHook],
				}),
			);

			runDispatcher(metadataPath);

			assert.equal(existsSync(stalePreviousMarker), false);
			assert.equal(readFileSync(nomxMarker, "utf-8"), "ran");
		} finally {
			rmSync(wd, { recursive: true, force: true });
		}
	});

	it("skips reporter-shaped SkyComputerUseClient previousNotify dispatcher recursion", () => {
		const wd = mkdtempSync(join(tmpdir(), "nomx-notify-dispatcher-reporter-wrapper-"));
		try {
			const pkgScripts = join(wd, "pkg-without-managed-name", "dist", "scripts");
			mkdirSync(pkgScripts, { recursive: true });
			const stalePreviousMarker = join(wd, "skycomputer-ran");
			const nomxMarker = join(wd, "nomx-ran");
			const dispatcher = join(pkgScripts, "notify-dispatcher.js");
			const turnEndedWrapper = join(wd, "SkyComputerUseClient");
			const nomxHook = join(wd, "current-notify-hook.js");
			writeFileSync(dispatcher, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(stalePreviousMarker)}, "dispatcher");\n`);
			writeFileSync(
				turnEndedWrapper,
				`#!/usr/bin/env node\nimport { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(stalePreviousMarker)}, "wrapper\\n");\n`,
			);
			chmodSync(turnEndedWrapper, 0o755);
			writeFileSync(nomxHook, `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(nomxMarker)}, "nomx\\n");\n`);
			const metadataPath = join(wd, "notify-dispatch.json");
			writeFileSync(
				metadataPath,
				JSON.stringify({
					managedBy: "nomx",
					version: 1,
					previousNotify: [
						turnEndedWrapper,
						"turn-ended",
						"--previous-notify",
						JSON.stringify([
							"node",
							dispatcher,
							"--metadata",
							metadataPath,
						]),
					],
					nomxNotify: [process.execPath, nomxHook],
					dispatcherNotify: ["node", dispatcher, "--metadata", metadataPath],
				}),
			);

			runDispatcher(metadataPath);

			assert.equal(existsSync(stalePreviousMarker), false);
			assert.equal(readFileSync(nomxMarker, "utf-8"), "nomx\n");
		} finally {
			rmSync(wd, { recursive: true, force: true });
		}
	});

	it("preserves and runs real user previousNotify entries", () => {
		const wd = mkdtempSync(join(tmpdir(), "nomx-notify-dispatcher-user-"));
		try {
			const userMarker = join(wd, "user-ran");
			const nomxMarker = join(wd, "nomx-ran");
			const userScript = join(wd, "user-notify.js");
			const nomxHook = join(wd, "current-notify-hook.js");
			writeFileSync(userScript, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(userMarker)}, "ran");\n`);
			writeFileSync(nomxHook, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(nomxMarker)}, "ran");\n`);
			const metadataPath = join(wd, "notify-dispatch.json");
			writeFileSync(
				metadataPath,
				JSON.stringify({
					managedBy: "nomx",
					version: 1,
					previousNotify: [process.execPath, userScript],
					nomxNotify: [process.execPath, nomxHook],
				}),
			);

			runDispatcher(metadataPath);

			assert.equal(readFileSync(userMarker, "utf-8"), "ran");
			assert.equal(readFileSync(nomxMarker, "utf-8"), "ran");
		} finally {
			rmSync(wd, { recursive: true, force: true });
		}
	});

	it("does not mistake real user notify arguments for managed entrypoints", () => {
		const wd = mkdtempSync(join(tmpdir(), "nomx-notify-dispatcher-user-arg-"));
		try {
			const userMarker = join(wd, "user-ran");
			const userScript = join(wd, "user-notify.js");
			writeFileSync(
				userScript,
				`import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(userMarker)}, process.argv.slice(2).join("\\n"));\n`,
			);
			const metadataPath = join(wd, "notify-dispatch.json");
			writeFileSync(
				metadataPath,
				JSON.stringify({
					managedBy: "nomx",
					version: 1,
					previousNotify: [
						process.execPath,
						userScript,
						"/opt/homebrew/lib/node_modules/nomx/dist/scripts/notify-hook.js",
					],
				}),
			);

			runDispatcher(metadataPath);

			assert.match(readFileSync(userMarker, "utf-8"), /notify-hook\.js/);
		} finally {
			rmSync(wd, { recursive: true, force: true });
		}
	});
});
