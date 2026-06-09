// WhatsApp plugin module implements error policy behavior.
import type { WhatsAppAccountConfig } from "./account-types.js";
import {
  asDateTimestampMs,
  isFutureDateTimestampMs,
  resolveExpiresAtMsFromDurationMs,
} from "openclaw/plugin-sdk/number-runtime";

type WhatsAppErrorPolicy = "always" | "once" | "silent";

type WhatsAppErrorConfig = {
  errorPolicy?: WhatsAppErrorPolicy;
  errorCooldownMs?: number;
};

const errorCooldownStore = new Map<string, Map<string, number>>();
const DEFAULT_ERROR_COOLDOWN_MS = 14400000; // 4 hours

function pruneExpiredCooldowns(messageStore: Map<string, number>, now: number) {
  for (const [message, expiresAt] of messageStore) {
    if (!isFutureDateTimestampMs(expiresAt, { nowMs: now })) {
      messageStore.delete(message);
    }
  }
}

export function resolveWhatsAppErrorPolicy(params: {
  accountConfig?: WhatsAppAccountConfig;
  groupConfig?: WhatsAppErrorConfig;
}): {
  policy: WhatsAppErrorPolicy;
  cooldownMs: number;
} {
  const configs: Array<WhatsAppErrorConfig | undefined> = [
    params.accountConfig,
    params.groupConfig,
  ];
  // Default to "silent" to preserve backward compatibility: WhatsApp has historically
  // suppressed isError payloads. Operators can opt into "always" or "once" explicitly.
  let policy: WhatsAppErrorPolicy = "silent";
  let cooldownMs = DEFAULT_ERROR_COOLDOWN_MS;

  for (const config of configs) {
    if (config?.errorPolicy) {
      policy = config.errorPolicy;
    }
    if (typeof config?.errorCooldownMs === "number") {
      cooldownMs = config.errorCooldownMs;
    }
  }

  return { policy, cooldownMs };
}

export function buildWhatsAppErrorScopeKey(params: {
  accountId: string;
  chatId: string;
}): string {
  return `${params.accountId}:${params.chatId}`;
}

export function shouldSuppressWhatsAppError(params: {
  scopeKey: string;
  cooldownMs: number;
  errorMessage?: string;
}): boolean {
  const { scopeKey, cooldownMs, errorMessage } = params;
  const now = asDateTimestampMs(Date.now());
  const messageKey = errorMessage ?? "";
  const scopeStore = errorCooldownStore.get(scopeKey);
  if (now === undefined) {
    errorCooldownStore.delete(scopeKey);
    return false;
  }

  if (scopeStore) {
    pruneExpiredCooldowns(scopeStore, now);
    if (scopeStore.size === 0) {
      errorCooldownStore.delete(scopeKey);
    }
  }

  if (errorCooldownStore.size > 100) {
    for (const [scope, messageStore] of errorCooldownStore) {
      pruneExpiredCooldowns(messageStore, now);
      if (messageStore.size === 0) {
        errorCooldownStore.delete(scope);
      }
    }
  }

  const expiresAt = scopeStore?.get(messageKey);
  if (isFutureDateTimestampMs(expiresAt, { nowMs: now })) {
    return true;
  }

  const nextExpiresAt = resolveExpiresAtMsFromDurationMs(cooldownMs, { nowMs: now });
  if (nextExpiresAt === undefined) {
    scopeStore?.delete(messageKey);
    return false;
  }
  const nextScopeStore = scopeStore ?? new Map<string, number>();
  nextScopeStore.set(messageKey, nextExpiresAt);
  errorCooldownStore.set(scopeKey, nextScopeStore);
  return false;
}

export function isSilentWhatsAppErrorPolicy(policy: WhatsAppErrorPolicy): boolean {
  return policy === "silent";
}

export function resetWhatsAppErrorPolicyStoreForTest() {
  errorCooldownStore.clear();
}
