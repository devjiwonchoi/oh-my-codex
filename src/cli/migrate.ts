import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { nominalRootPair, NOMX_IDENTITY, LEGACY_OMX_IDENTITY, NamespaceError, type NomxRootPair } from "../identity/index.js";
import { createMigrationHandoff, migrateRoot, rollbackMigration, runMigrationHandoff } from "./migrate-core.js";

type MigrationScope = "project" | "user" | "all";

function optionValue(args: string[], name: string): string | undefined {
  const equals = args.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function scopePairs(scope: MigrationScope, cwd: string, home: string): NomxRootPair[] {
  const project = nominalRootPair(cwd);
  const user: NomxRootPair = {
    projectRoot: resolve(home),
    canonicalRoot: join(resolve(home), NOMX_IDENTITY.userDirectoryName),
    legacyRoot: join(resolve(home), LEGACY_OMX_IDENTITY.userDirectoryName),
  };
  const requested = scope === "all" ? [project, user] : scope === "user" ? [user] : [project];
  return requested.filter((pair, index) => requested.findIndex((candidate) => candidate.canonicalRoot === pair.canonicalRoot) === index);
}

function writeOutput(value: unknown, json: boolean): void {
  if (json) process.stdout.write(`${JSON.stringify(value)}\n`);
  else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export async function migrateCommand(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const json = args.includes("--json");
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`Usage:\n  nomx migrate --dry-run [--scope project|user|all] [--json]\n  nomx migrate --artifact <proven-tarball> [--scope project|user|all] [--json]\n  nomx migrate rollback --journal <path>\n  nomx migrate handoff create --path <path> --artifact <path> --session-id <id> --task-id <id>\n  nomx migrate handoff run <path>\n`);
    return;
  }
  const subcommand = args[0];
  if (subcommand === "rollback") {
    const journal = optionValue(args, "--journal");
    if (!journal) throw new Error("nomx migrate rollback requires --journal <path>");
    writeOutput(await rollbackMigration(journal), json);
    return;
  }
  if (subcommand === "handoff") {
    const operation = args[1];
    if (operation === "run") {
      const path = args[2];
      const token = env.NOMX_HANDOFF_TOKEN ?? optionValue(args, "--token");
      if (!path || !token) throw new Error("nomx migrate handoff run requires <path> and NOMX_HANDOFF_TOKEN");
      writeOutput(await runMigrationHandoff(path, token), json);
      return;
    }
    if (operation === "create") {
      const path = optionValue(args, "--path");
      const artifactPath = optionValue(args, "--artifact");
      const sessionId = optionValue(args, "--session-id");
      const taskId = optionValue(args, "--task-id");
      if (!path || !artifactPath || !sessionId || !taskId) {
        throw new Error("nomx migrate handoff create requires --path, --artifact, --session-id, and --task-id");
      }
      const pair = scopePairs("project", process.cwd(), homedir())[0];
      const created = await createMigrationHandoff({
        path,
        pair,
        artifactPath,
        initiatingSessionId: sessionId,
        initiatingTaskId: taskId,
        initiatingSessionLease: optionValue(args, "--session-lease"),
      });
      writeOutput({ path: created.path, token: created.token, record: created.record }, json);
      return;
    }
    throw new Error("nomx migrate handoff expects create or run");
  }

  const rawScope = optionValue(args, "--scope") ?? "project";
  if (!["project", "user", "all"].includes(rawScope)) throw new Error("--scope must be project, user, or all");
  const dryRun = args.includes("--dry-run");
  const artifactPath = optionValue(args, "--artifact");
  if (!dryRun && !artifactPath) throw new NamespaceError("migration_verification_failed", "Real migration requires --artifact <proven-tarball-path>");
  const results = [];
  for (const pair of scopePairs(rawScope as MigrationScope, process.cwd(), homedir())) {
    results.push(await migrateRoot({
      pair,
      dryRun,
      artifactPath,
      logPath: optionValue(args, "--log"),
    }));
  }
  writeOutput(results, json);
}
