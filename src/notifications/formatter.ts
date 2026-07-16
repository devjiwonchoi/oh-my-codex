import { basename } from "path";
import type { FullNotificationPayload } from "./types.js";

function formatDuration(ms?: number): string {
  if (!ms) return "unknown";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function projectDisplay(payload: FullNotificationPayload): string {
  if (payload.projectName) return payload.projectName;
  if (payload.projectPath) return basename(payload.projectPath);
  return "unknown";
}

function footer(payload: FullNotificationPayload): string {
  return `**project:** \`${projectDisplay(payload)}\``;
}

export function formatSessionStart(payload: FullNotificationPayload): string {
  return [
    "# Session Started",
    "",
    `**Session:** \`${payload.sessionId}\``,
    `**Project:** \`${projectDisplay(payload)}\``,
    `**Time:** ${new Date(payload.timestamp).toLocaleTimeString()}`,
  ].join("\n");
}

export function formatSessionStop(payload: FullNotificationPayload): string {
  const lines = ["# Session Continuing", ""];
  if (payload.activeMode) lines.push(`**Mode:** ${payload.activeMode}`);
  if (payload.iteration != null && payload.maxIterations != null) {
    lines.push(`**Iteration:** ${payload.iteration}/${payload.maxIterations}`);
  }
  if (payload.incompleteTasks != null && payload.incompleteTasks > 0) {
    lines.push(`**Incomplete tasks:** ${payload.incompleteTasks}`);
  }
  lines.push("", footer(payload));
  return lines.join("\n");
}

export function formatSessionEnd(payload: FullNotificationPayload): string {
  const lines = [
    "# Session Ended",
    "",
    `**Session:** \`${payload.sessionId}\``,
    `**Duration:** ${formatDuration(payload.durationMs)}`,
    `**Reason:** ${payload.reason || "unknown"}`,
  ];
  if (payload.agentsSpawned != null) {
    lines.push(`**Agents:** ${payload.agentsCompleted ?? 0}/${payload.agentsSpawned} completed`);
  }
  if (payload.modesUsed?.length) lines.push(`**Modes:** ${payload.modesUsed.join(", ")}`);
  if (payload.contextSummary) lines.push("", `**Summary:** ${payload.contextSummary}`);
  lines.push("", footer(payload));
  return lines.join("\n");
}

export function formatSessionIdle(payload: FullNotificationPayload): string {
  const lines = ["# Session Idle", "", "Codex has finished and is waiting for input.", ""];
  if (payload.reason) lines.push(`**Reason:** ${payload.reason}`);
  if (payload.modesUsed?.length) lines.push(`**Modes:** ${payload.modesUsed.join(", ")}`);
  lines.push("", footer(payload));
  return lines.join("\n");
}

export function formatAskUserQuestion(payload: FullNotificationPayload): string {
  const lines = ["# Input Needed", ""];
  if (payload.question) lines.push(`**Question:** ${payload.question}`, "");
  lines.push("Codex is waiting for your response.", "", footer(payload));
  return lines.join("\n");
}

export function formatNotification(payload: FullNotificationPayload): string {
  switch (payload.event) {
    case "session-start": return formatSessionStart(payload);
    case "session-stop": return formatSessionStop(payload);
    case "session-end": return formatSessionEnd(payload);
    case "session-idle": return formatSessionIdle(payload);
    case "ask-user-question": return formatAskUserQuestion(payload);
    default: return payload.message || `Event: ${payload.event}`;
  }
}
