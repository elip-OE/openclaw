// Aws Sms plugin module implements webhook behavior.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-types";
import { createFixedWindowRateLimiter } from "openclaw/plugin-sdk/webhook-ingress";
import { readRequestBodyWithLimit } from "openclaw/plugin-sdk/webhook-ingress";
import { dispatchAwsSmsInboundEvent } from "./inbound.js";
import {
  confirmSnsSubscription,
  parseSnsWebhookBody,
  verifySnsEnvelopeSignature,
} from "./sns-webhook.js";
import type { ResolvedAwsSmsAccount } from "./types.js";

const rateLimiter = createFixedWindowRateLimiter({
  maxRequests: 30,
  windowMs: 60_000,
  maxTrackedKeys: 5_000,
});
const REPLAY_CACHE_TTL_MS = 10 * 60_000;
const REPLAY_CACHE_MAX_KEYS = 10_000;
const replayCache = new Map<string, number>();
const WEBHOOK_BODY_LIMIT_BYTES = 256 * 1024;
const WEBHOOK_BODY_TIMEOUT_MS = 5_000;

type AwsSmsWebhookLog = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

export type AwsSmsWebhookHandlerParams = {
  cfg: OpenClawConfig;
  account: ResolvedAwsSmsAccount;
  log?: AwsSmsWebhookLog;
};

function rateLimitKey(req: IncomingMessage): string {
  return req.socket?.remoteAddress ?? "unknown";
}

function rememberWebhookMessage(params: {
  accountId: string;
  messageId: string;
  now?: number;
}): boolean {
  const now = params.now ?? Date.now();
  for (const [key, expiresAt] of replayCache) {
    if (expiresAt > now && replayCache.size <= REPLAY_CACHE_MAX_KEYS) {
      break;
    }
    replayCache.delete(key);
  }
  const key = `${params.accountId}:${params.messageId}`;
  if ((replayCache.get(key) ?? 0) > now) {
    return false;
  }
  replayCache.set(key, now + REPLAY_CACHE_TTL_MS);
  return true;
}

export function resetAwsSmsWebhookReplayCacheForTest(): void {
  replayCache.clear();
}

function respondJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export function createAwsSmsWebhookHandler(params: AwsSmsWebhookHandlerParams) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      respondJson(res, 405, { ok: false, error: "Method not allowed" });
      return true;
    }

    const key = rateLimitKey(req);
    if (rateLimiter.isRateLimited(key)) {
      params.log?.warn?.(`AWS SMS webhook rate limit exceeded for ${key}`);
      respondJson(res, 429, { ok: false, error: "Rate limit exceeded" });
      return true;
    }

    let rawBody = "";
    try {
      rawBody = await readRequestBodyWithLimit(req, {
        maxBytes: WEBHOOK_BODY_LIMIT_BYTES,
        timeoutMs: WEBHOOK_BODY_TIMEOUT_MS,
      });
    } catch {
      respondJson(res, 400, { ok: false, error: "Invalid request body" });
      return true;
    }

    const parsed = parseSnsWebhookBody(rawBody);
    if (parsed.kind === "unsupported") {
      params.log?.warn?.(`AWS SMS webhook rejected payload: ${parsed.reason}`);
      respondJson(res, 400, { ok: false, error: parsed.reason });
      return true;
    }

    const signatureOk = await verifySnsEnvelopeSignature({ envelope: parsed.envelope });
    if (!signatureOk) {
      params.log?.warn?.("AWS SMS webhook rejected invalid SNS signature");
      respondJson(res, 403, { ok: false, error: "Invalid SNS signature" });
      return true;
    }

    if (
      params.account.inboundSnsTopicArn &&
      parsed.envelope.TopicArn &&
      parsed.envelope.TopicArn !== params.account.inboundSnsTopicArn
    ) {
      params.log?.warn?.("AWS SMS webhook rejected mismatched SNS TopicArn");
      respondJson(res, 403, { ok: false, error: "Invalid topic" });
      return true;
    }

    if (parsed.kind === "subscription_confirmation") {
      if (!params.account.autoConfirmSnsSubscription) {
        params.log?.info?.(
          "AWS SMS received SNS SubscriptionConfirmation; autoConfirmSnsSubscription is disabled.",
        );
        respondJson(res, 200, { ok: true, pendingConfirmation: true });
        return true;
      }
      if (!parsed.envelope.TopicArn || !parsed.envelope.Token || !params.account.region) {
        respondJson(res, 400, { ok: false, error: "Missing SNS subscription confirmation fields" });
        return true;
      }
      try {
        await confirmSnsSubscription({
          topicArn: parsed.envelope.TopicArn,
          token: parsed.envelope.Token,
          region: params.account.region,
        });
        params.log?.info?.(`AWS SMS confirmed SNS subscription for ${parsed.envelope.TopicArn}`);
        respondJson(res, 200, { ok: true, confirmed: true });
      } catch (err) {
        params.log?.error?.(
          `AWS SMS SNS subscription confirmation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        respondJson(res, 500, { ok: false, error: "Subscription confirmation failed" });
      }
      return true;
    }

    if (parsed.kind === "unsubscribe_confirmation") {
      respondJson(res, 200, { ok: true });
      return true;
    }

    if (
      !rememberWebhookMessage({
        accountId: params.account.accountId,
        messageId: parsed.inbound.messageId,
      })
    ) {
      params.log?.warn?.(`AWS SMS webhook ignored replayed message ${parsed.inbound.messageId}`);
      respondJson(res, 200, { ok: true, replay: true });
      return true;
    }

    void dispatchAwsSmsInboundEvent({
      cfg: params.cfg,
      account: params.account,
      msg: parsed.inbound,
      log: params.log,
    }).catch((err: unknown) => {
      params.log?.error?.(
        `AWS SMS webhook dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    respondJson(res, 200, { ok: true });
    return true;
  };
}
