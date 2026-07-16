export const SETUP_TEAM_MODES = ["enabled", "disabled"] as const;
export type SetupTeamMode = (typeof SETUP_TEAM_MODES)[number];

export interface TeamModeConfig {
	enabled: boolean;
	status: "enabled" | "disabled" | "defaulted" | "invalid";
	source: "default" | "env" | "setup" | "file" | "invalid";
	path?: string;
}

export function isSetupTeamMode(value: string): value is SetupTeamMode {
	return SETUP_TEAM_MODES.includes(value as SetupTeamMode);
}

export function teamModeEnabled(_mode: SetupTeamMode | undefined): boolean {
	return false;
}

export function readTeamModeConfig(_cwd = process.cwd()): TeamModeConfig {
	return { enabled: false, status: "disabled", source: "default" };
}
