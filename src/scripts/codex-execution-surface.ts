type CodexHookEventName =
  | "SessionStart"
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "PreCompact"
  | "PostCompact"
  | "Stop";

type CodexHookPayload = Record<string, unknown>;

export type CodexLauncherKind = "native" | "direct";

export interface CodexExecutionSurface {
  launcher: CodexLauncherKind;
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readPersistedSessionStateSync(cwd: string): Record<string, unknown> | null {
  const path = join(cwd, ".nomx", "state", "session.json");
  if (!existsSync(path)) return null;
  try {
    return safeObject(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return null;
  }
}

export function resolveCodexExecutionSurface(
  cwd: string,
  options: {
    hookEventName?: CodexHookEventName | null;
    payload?: CodexHookPayload;
    canonicalSessionId?: string;
    nativeSessionId?: string;
  } = {},
): CodexExecutionSurface {
  const payloadSessionId = safeString(options.payload?.session_id ?? options.payload?.sessionId).trim();
  const payloadSource = safeString(options.payload?.source).trim().toLowerCase();
  const persistedSession = readPersistedSessionStateSync(cwd);
  const persistedNativeSessionId = safeString(persistedSession?.native_session_id).trim();
  const explicitDirectSource = payloadSource === "cli" || payloadSource === "shell" || payloadSource === "terminal";
  const explicitNativeSource = payloadSource === "native" || payloadSource === "codex-app" || payloadSource === "app";
  const launcher: CodexLauncherKind = !explicitDirectSource && (
    explicitNativeSource
    || (options.hookEventName === "SessionStart" && safeString(options.nativeSessionId).trim() !== "")
    || (!!payloadSessionId && payloadSessionId === persistedNativeSessionId)
    || (
      !!safeString(options.canonicalSessionId).trim()
      && !!safeString(options.nativeSessionId).trim()
      && safeString(options.canonicalSessionId).trim() !== safeString(options.nativeSessionId).trim()
    )
  )
    ? "native"
    : "direct";

  return { launcher };
}
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
