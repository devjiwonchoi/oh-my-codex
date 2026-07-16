import { join } from "path";
import type { UnifiedMcpRegistryServer } from "./mcp-registry.js";

export const NOMX_PLUGIN_MCP_COMMAND = "nomx";
export const NOMX_PLUGIN_MCP_SERVE_SUBCOMMAND = "mcp-serve";

type NomxFirstPartyMcpSpec = {
  name: string;
  title: string;
  entrypoint: string;
  pluginTarget: string;
  startupTimeoutSec: number;
};

const NOMX_FIRST_PARTY_MCP_SPECS: readonly NomxFirstPartyMcpSpec[] = [
  {
    name: "nomx_state",
    title: "# NOMX State Management MCP Server",
    entrypoint: "state-server.js",
    pluginTarget: "state",
    startupTimeoutSec: 5,
  },
  {
    name: "nomx_memory",
    title: "# NOMX Project Memory MCP Server",
    entrypoint: "memory-server.js",
    pluginTarget: "memory",
    startupTimeoutSec: 5,
  },
  {
    name: "nomx_code_intel",
    title: "# NOMX Code Intelligence MCP Server (LSP diagnostics, AST search)",
    entrypoint: "code-intel-server.js",
    pluginTarget: "code-intel",
    startupTimeoutSec: 10,
  },
  {
    name: "nomx_trace",
    title: "# NOMX Trace MCP Server (agent flow timeline & statistics)",
    entrypoint: "trace-server.js",
    pluginTarget: "trace",
    startupTimeoutSec: 5,
  },
  {
    name: "nomx_hermes",
    title: "# NOMX Hermes Coordination MCP Server (safe dispatch/status/artifacts)",
    entrypoint: "hermes-server.js",
    pluginTarget: "hermes",
    startupTimeoutSec: 5,
  },
] as const;

export const NOMX_FIRST_PARTY_MCP_SERVER_NAMES = NOMX_FIRST_PARTY_MCP_SPECS.map(
  (spec) => spec.name,
);

export const NOMX_FIRST_PARTY_MCP_ENTRYPOINTS = NOMX_FIRST_PARTY_MCP_SPECS.map(
  (spec) => spec.entrypoint,
);

export const NOMX_FIRST_PARTY_MCP_PLUGIN_TARGETS = NOMX_FIRST_PARTY_MCP_SPECS.map(
  (spec) => spec.pluginTarget,
);

export function resolveNomxFirstPartyMcpEntrypointForPluginTarget(
  target: string | undefined,
): string | null {
  if (typeof target !== "string") return null;
  const normalized = target.trim().toLowerCase();
  if (!normalized) return null;
  const spec = NOMX_FIRST_PARTY_MCP_SPECS.find(
    (candidate) =>
      candidate.pluginTarget === normalized ||
      candidate.entrypoint === normalized,
  );
  return spec?.entrypoint ?? null;
}

export function getCurrentNodeExecutablePath(): string {
  return process.execPath;
}

export function getNomxFirstPartySetupMcpServers(
  pkgRoot: string,
): Array<UnifiedMcpRegistryServer & { title: string }> {
  return NOMX_FIRST_PARTY_MCP_SPECS.map((spec) => ({
    name: spec.name,
    title: spec.title,
    command: getCurrentNodeExecutablePath(),
    args: [join(pkgRoot, "dist", "mcp", spec.entrypoint)],
    enabled: true,
    startupTimeoutSec: spec.startupTimeoutSec,
  }));
}

export function buildNomxPluginMcpManifest(
  options: { enabled?: boolean } = {},
): {
  mcpServers: Record<
    string,
    {
      command: string;
      args: string[];
      enabled: boolean;
    }
  >;
} {
  return {
    mcpServers: Object.fromEntries(
      NOMX_FIRST_PARTY_MCP_SPECS.map((spec) => [
        spec.name,
        {
          command: NOMX_PLUGIN_MCP_COMMAND,
          args: [NOMX_PLUGIN_MCP_SERVE_SUBCOMMAND, spec.pluginTarget],
          enabled: options.enabled === true,
        },
      ]),
    ),
  };
}
