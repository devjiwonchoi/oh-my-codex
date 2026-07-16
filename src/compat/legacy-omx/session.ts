/** Stable value-prefix adapter for session records copied from legacy OMX roots. */
export const LEGACY_OMX_SESSION_ID_PREFIX = "omx-";

export function isLegacyOmxSessionId(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(LEGACY_OMX_SESSION_ID_PREFIX);
}
