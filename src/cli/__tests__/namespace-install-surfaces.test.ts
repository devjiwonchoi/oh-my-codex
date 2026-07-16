import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	prepareNomxRoot,
	resolveSetupNamespaceBase,
} from "../setup.js";
import {
	checkNomxNamespaceAuthority,
	resolveDoctorNamespaceBase,
} from "../doctor.js";
import { uninstall } from "../uninstall.js";
import { validateNomxRootMetadata } from "../../identity/index.js";

describe("NOMX install surface namespace authority", () => {
	it("selects the user home for user scope and cwd for project scope", () => {
		const cwd = "/work/project";
		const userHome = "/home/tester";
		assert.equal(resolveSetupNamespaceBase("user", cwd, userHome), userHome);
		assert.equal(resolveSetupNamespaceBase("project", cwd, userHome), cwd);
		assert.equal(resolveDoctorNamespaceBase("user", cwd, userHome), userHome);
		assert.equal(resolveDoctorNamespaceBase("project", cwd, userHome), cwd);
	});

	it("initializes valid canonical metadata for either selected scope root", async () => {
		for (const label of ["user", "project"] as const) {
			const base = await mkdtemp(join(tmpdir(), `nomx-${label}-scope-`));
			try {
				await prepareNomxRoot(base, false);
				const canonicalRoot = join(base, ".nomx");
				const metadata = JSON.parse(
					await readFile(join(canonicalRoot, "identity.json"), "utf8"),
				) as unknown;
				validateNomxRootMetadata(metadata, canonicalRoot);
				assert.equal((await checkNomxNamespaceAuthority(base)).status, "pass");
			} finally {
				await rm(base, { recursive: true, force: true });
			}
		}
	});

	it("keeps fresh dry-runs side-effect free", async () => {
		const base = await mkdtemp(join(tmpdir(), "nomx-dry-run-"));
		try {
			await prepareNomxRoot(base, true);
			assert.equal(existsSync(join(base, ".nomx")), false);
		} finally {
			await rm(base, { recursive: true, force: true });
		}
	});

	it("refuses legacy-only roots for both user and project setup targets", async () => {
		for (const label of ["user", "project"] as const) {
			const base = await mkdtemp(join(tmpdir(), `nomx-legacy-${label}-`));
			try {
				await mkdir(join(base, ".omx"));
				await assert.rejects(
					prepareNomxRoot(base, false),
					(error: unknown) =>
						error instanceof Error &&
						"code" in error &&
						(error as Error & { code: string }).code === "migration_required",
				);
				const doctorCheck = await checkNomxNamespaceAuthority(base);
				assert.equal(doctorCheck.status, "fail");
				assert.match(doctorCheck.message, /nomx migrate/);
			} finally {
				await rm(base, { recursive: true, force: true });
			}
		}
	});

	it("refuses uninstall writes against a legacy-only project root", async () => {
		const base = await mkdtemp(join(tmpdir(), "nomx-legacy-uninstall-"));
		const previousCwd = process.cwd();
		try {
			await mkdir(join(base, ".omx"));
			process.chdir(base);
			await assert.rejects(
				uninstall({ scope: "project", dryRun: true, keepConfig: true }),
				(error: unknown) =>
					error instanceof Error &&
					"code" in error &&
					(error as Error & { code: string }).code === "migration_required",
			);
		} finally {
			process.chdir(previousCwd);
			await rm(base, { recursive: true, force: true });
		}
	});
});
