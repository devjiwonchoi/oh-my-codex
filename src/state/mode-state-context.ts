export interface ModeStateContextLike {
  active?: unknown;
  [key: string]: unknown;
}

/** Runtime state is scoped to the active session. */
export function withModeRuntimeContext<T extends ModeStateContextLike>(
  _existing: ModeStateContextLike,
  next: T,
  _options?: { env?: NodeJS.ProcessEnv; nowIso?: string },
): T {
  return next;
}
