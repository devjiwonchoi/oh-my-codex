/** Legacy package identity accepted only for migration diagnostics and rejection. */
export const LEGACY_PACKAGE_NAME = "oh-my-codex";

export function referencesLegacyDistribution(value: string): boolean {
  return value.toLowerCase().includes(LEGACY_PACKAGE_NAME);
}
