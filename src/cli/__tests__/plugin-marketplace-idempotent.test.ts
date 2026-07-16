import assert from "node:assert/strict";
import { describe, it } from "node:test";
import TOML from "@iarna/toml";
import { NOMX_FIRST_PARTY_MCP_SERVER_NAMES } from "../../config/nomx-first-party-mcp.js";
import {
	NOMX_LOCAL_MARKETPLACE_NAME,
	NOMX_LOCAL_PLUGIN_CONFIG_KEY,
	upsertLocalOmxMarketplaceRegistration,
	upsertLocalOmxPluginEnablement,
	upsertLocalOmxPluginMcpServerEnablement,
} from "../plugin-marketplace.js";

function countMatches(content: string, pattern: RegExp): number {
	return [...content.matchAll(pattern)].length;
}

function applyPluginModeConfig(content: string, packageRoot: string): string {
	return upsertLocalOmxMarketplaceRegistration(
		upsertLocalOmxPluginMcpServerEnablement(
			upsertLocalOmxPluginEnablement(content),
			true,
		),
		packageRoot,
	);
}

describe("plugin marketplace config upserts", () => {
	it("keeps repeated plugin-mode setup config updates idempotent", () => {
		const packageRoot = "/tmp/nomx";
		const first = applyPluginModeConfig('model = "gpt-5.6-sol"\n', packageRoot);
		const second = applyPluginModeConfig(first, packageRoot);

		assert.equal(second, first);
		assert.equal(
			countMatches(second, /^\[marketplaces\.nomx-local\]$/gm),
			1,
		);
		assert.equal(
			countMatches(
				second,
				/^\[plugins\."nomx@nomx-local"\]$/gm,
			),
			1,
		);
		for (const serverName of NOMX_FIRST_PARTY_MCP_SERVER_NAMES) {
			assert.equal(
				countMatches(
					second,
					new RegExp(
						`^\\[plugins\\.${JSON.stringify(NOMX_LOCAL_PLUGIN_CONFIG_KEY).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.mcp_servers\\.${serverName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]$`,
						"gm",
					),
				),
				1,
				`${serverName} should be emitted once`,
			);
		}
		assert.doesNotThrow(() => TOML.parse(second));
	});

	it("normalizes a local plugin scalar before emitting the canonical plugin table", () => {
		const repaired = upsertLocalOmxPluginEnablement(
			[
				'model = "gpt-5.6-sol"',
				'',
				'[plugins]',
				`"${NOMX_LOCAL_PLUGIN_CONFIG_KEY}" = true`,
				'other-plugin = true',
				'',
			].join("\n"),
		);

		assert.doesNotThrow(() => TOML.parse(repaired));
		assert.doesNotMatch(repaired, new RegExp(`^"${NOMX_LOCAL_PLUGIN_CONFIG_KEY}"\\s*=`, "m"));
		assert.match(repaired, /^other-plugin = true$/m);
		assert.equal(
			countMatches(
				repaired,
				/^\[plugins\."nomx@nomx-local"\]$/gm,
			),
			1,
		);
	});

	it("dedupes existing local marketplace and plugin MCP blocks without removing unrelated config", () => {
		const packageRoot = "/tmp/nomx-new";
		const duplicated = [
			'model = "gpt-5.6-sol"',
			'',
			'[mcp_servers.user_tool]',
			'command = "user-tool"',
			'',
			`[plugins.${JSON.stringify(NOMX_LOCAL_PLUGIN_CONFIG_KEY)}]`,
			'enabled = false',
			'',
			`[plugins.${JSON.stringify(NOMX_LOCAL_PLUGIN_CONFIG_KEY)}]`,
			'enabled = false',
			'',
			`[plugins.${JSON.stringify(NOMX_LOCAL_PLUGIN_CONFIG_KEY)}.mcp_servers.nomx_state]`,
			'enabled = false',
			'',
			`[plugins.${JSON.stringify(NOMX_LOCAL_PLUGIN_CONFIG_KEY)}.mcp_servers.nomx_state]`,
			'enabled = false',
			'',
			`[marketplaces.${NOMX_LOCAL_MARKETPLACE_NAME}]`,
			'source_type = "local"',
			'source = "/tmp/old"',
			'',
			`[marketplaces.${NOMX_LOCAL_MARKETPLACE_NAME}]`,
			'source_type = "local"',
			'source = "/tmp/older"',
			'',
		].join("\n");

		assert.throws(() => TOML.parse(duplicated), /redefine|duplicate/i);

		const repaired = applyPluginModeConfig(duplicated, packageRoot);

		assert.doesNotThrow(() => TOML.parse(repaired));
		assert.match(repaired, /^\[mcp_servers\.user_tool\]$/m);
		assert.match(repaired, /^command = "user-tool"$/m);
		assert.equal(
			countMatches(repaired, /^\[marketplaces\.nomx-local\]$/gm),
			1,
		);
		assert.match(repaired, new RegExp(`^source = ${JSON.stringify(packageRoot)}$`, "m"));
		assert.equal(
			countMatches(
				repaired,
				/^\[plugins\."nomx@nomx-local"\.mcp_servers\.nomx_state\]$/gm,
			),
			1,
		);
	});
});
