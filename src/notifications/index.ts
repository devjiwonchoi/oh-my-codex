/**
 * Notification System - Public API
 *
 * Multi-platform lifecycle notifications for nomx.
 * Sends notifications to Discord, Telegram, Slack, and generic webhooks
 * on session lifecycle events.
 *
 * Usage:
 *   import { notifyLifecycle } from '../notifications/index.js';
 *   await notifyLifecycle('session-start', { sessionId, projectPath, ... });
 */

export type {
  NotificationEvent,
  NotificationPlatform,
  FullNotificationConfig,
  FullNotificationPayload,
  NotificationResult,
  DispatchResult,
  DiscordNotificationConfig,
  DiscordBotNotificationConfig,
  TelegramNotificationConfig,
  SlackNotificationConfig,
  WebhookNotificationConfig,
  EventNotificationConfig,
  NotificationProfilesConfig,
  NotificationsBlock,
  VerbosityLevel,
} from "./types.js";

export {
  dispatchNotifications,
  sendDiscord,
  sendDiscordBot,
  sendTelegram,
  sendSlack,
  sendWebhook,
} from "./dispatcher.js";
export {
  formatNotification,
  formatSessionStart,
  formatSessionStop,
  formatSessionEnd,
  formatSessionIdle,
  formatAskUserQuestion,
} from "./formatter.js";
export {
  getNotificationConfig,
  isEventEnabled,
  getEnabledPlatforms,
  resolveProfileConfig,
  listProfiles,
  getActiveProfileName,
  getVerbosity,
  isEventAllowedByVerbosity,
} from "./config.js";
// Re-export the legacy notifier for backward compatibility
export { notify, loadNotificationConfig } from "./notifier.js";
export type { NotificationConfig, NotificationPayload } from "./notifier.js";

// Dispatch cooldown exports
export {
  getDispatchNotificationCooldownSeconds,
  shouldSendDispatchNotification,
  recordDispatchNotificationSent,
} from "./dispatch-cooldown.js";

// Idle cooldown exports (for backward compatibility)
export {
  getIdleNotificationCooldownSeconds,
  shouldSendIdleNotification,
  recordIdleNotificationSent,
} from "./idle-cooldown.js";

// Template engine exports
export {
  interpolateTemplate,
  validateTemplate,
  computeTemplateVariables,
  getDefaultTemplate,
} from "./template-engine.js";

// Hook config exports
export {
  getHookConfig,
  resetHookConfigCache,
  resolveEventTemplate,
  mergeHookConfigIntoNotificationConfig,
} from "./hook-config.js";
export type {
  HookNotificationConfig,
  HookEventConfig,
  PlatformTemplateOverride,
  TemplateVariable,
} from "./hook-config-types.js";

import type {
  NotificationEvent,
  FullNotificationPayload,
  DispatchResult,
} from "./types.js";
import { getNotificationConfig, isEventEnabled, getActiveProfileName } from "./config.js";
import { formatNotification } from "./formatter.js";
import { dispatchNotifications } from "./dispatcher.js";
import { basename } from "path";
import { nomxStateDir } from "../utils/paths.js";
import {
  shouldSendLifecycleNotification,
  recordLifecycleNotificationSent,
} from "./lifecycle-dedupe.js";

// Suppress unused import — used by callers via re-export
void getActiveProfileName;

/**
 * High-level notification function for lifecycle events.
 *
 * Reads config, checks if the event is enabled, formats the message,
 * and dispatches to all configured platforms. Non-blocking, swallows errors.
 */
interface NotificationLifecycleOptions {
  persistScopedReceipts?: boolean;
}

export async function notifyLifecycle(
  event: NotificationEvent,
  data: Partial<FullNotificationPayload> & { sessionId: string },
  profileName?: string,
  options: NotificationLifecycleOptions = {},
): Promise<DispatchResult | null> {
  try {
    const config = getNotificationConfig(profileName);
    if (!config || !isEventEnabled(config, event)) {
      return null;
    }

    const payload: FullNotificationPayload = {
      event,
      sessionId: data.sessionId,
      message: "",
      timestamp: data.timestamp || new Date().toISOString(),
      projectPath: data.projectPath,
      projectName:
        data.projectName ||
        (data.projectPath ? basename(data.projectPath) : undefined),
      modesUsed: data.modesUsed,
      contextSummary: data.contextSummary,
      durationMs: data.durationMs,
      agentsSpawned: data.agentsSpawned,
      agentsCompleted: data.agentsCompleted,
      reason: data.reason,
      activeMode: data.activeMode,
      iteration: data.iteration,
      maxIterations: data.maxIterations,
      question: data.question,
      incompleteTasks: data.incompleteTasks,
    };

    const lifecycleStateDir = payload.projectPath ? nomxStateDir(payload.projectPath) : "";

    payload.message = data.message || formatNotification(payload);

    if (!shouldSendLifecycleNotification(lifecycleStateDir, payload)) {
      return {
        event,
        anySuccess: true,
        results: [],
      };
    }

    const result = await dispatchNotifications(config, event, payload);
    if (result.anySuccess && options.persistScopedReceipts !== false) {
      recordLifecycleNotificationSent(lifecycleStateDir, payload);
    }

    return result;
  } catch (error) {
    console.error(
      "[notifications] Error:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
