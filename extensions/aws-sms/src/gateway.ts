// Aws Sms plugin module implements gateway behavior.
import { waitUntilAbort } from "openclaw/plugin-sdk/channel-lifecycle";
import { registerPluginHttpRoute } from "openclaw/plugin-sdk/webhook-ingress";
import { collectAwsSmsDoctorHints, collectAwsSmsStartupWarnings } from "./doctor.js";
import type { ResolvedAwsSmsAccount } from "./types.js";
import { createAwsSmsWebhookHandler, type AwsSmsWebhookHandlerParams } from "./webhook.js";

const CHANNEL_ID = "aws-sms";

const activeRoutes = new Map<string, () => void>();
const activeRoutePaths = new Map<string, string>();

type AwsSmsGatewayLog = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

function routeKey(account: ResolvedAwsSmsAccount): string {
  return `${account.accountId}:${normalizeWebhookPath(account.webhookPath)}`;
}

function normalizeWebhookPath(pathValue: string): string {
  const trimmed = pathValue.trim();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function registerAwsSmsWebhookRoute(params: {
  cfg: AwsSmsWebhookHandlerParams["cfg"];
  account: ResolvedAwsSmsAccount;
  channelRuntime: AwsSmsWebhookHandlerParams["channelRuntime"];
  log?: AwsSmsGatewayLog;
}): () => void {
  const key = routeKey(params.account);
  const webhookPath = normalizeWebhookPath(params.account.webhookPath);
  const currentPathOwner = activeRoutePaths.get(webhookPath);
  if (currentPathOwner && currentPathOwner !== params.account.accountId) {
    throw new Error(
      `AWS SMS webhook path ${webhookPath} is already registered by account ${currentPathOwner}; configure a distinct webhookPath for account ${params.account.accountId}.`,
    );
  }
  activeRoutes.get(key)?.();
  activeRoutePaths.delete(webhookPath);
  const unregister = registerPluginHttpRoute({
    path: webhookPath,
    auth: "plugin",
    pluginId: CHANNEL_ID,
    accountId: params.account.accountId,
    log: (msg) => params.log?.info?.(msg),
    handler: createAwsSmsWebhookHandler(params),
  });
  activeRoutes.set(key, unregister);
  activeRoutePaths.set(webhookPath, params.account.accountId);
  return () => {
    unregister();
    activeRoutes.delete(key);
    if (activeRoutePaths.get(webhookPath) === params.account.accountId) {
      activeRoutePaths.delete(webhookPath);
    }
  };
}

export async function startAwsSmsGatewayAccount(params: {
  cfg: AwsSmsWebhookHandlerParams["cfg"];
  account: ResolvedAwsSmsAccount;
  channelRuntime: AwsSmsWebhookHandlerParams["channelRuntime"];
  abortSignal: AbortSignal;
  log?: AwsSmsGatewayLog;
}) {
  if (!params.account.enabled) {
    params.log?.info?.(`AWS SMS account ${params.account.accountId} is disabled`);
    return waitUntilAbort(params.abortSignal);
  }
  const warnings = collectAwsSmsStartupWarnings(params.account);
  if (warnings.some((warning) => warning.includes("required"))) {
    for (const warning of warnings) {
      params.log?.warn?.(warning);
    }
    for (const hint of collectAwsSmsDoctorHints(params.account)) {
      params.log?.warn?.(hint);
    }
    return waitUntilAbort(params.abortSignal);
  }
  for (const warning of warnings) {
    params.log?.warn?.(warning);
  }
  const unregister = registerAwsSmsWebhookRoute(params);
  params.log?.info?.(
    `Registered AWS SMS webhook route ${params.account.webhookPath} for account ${params.account.accountId}`,
  );
  return waitUntilAbort(params.abortSignal, unregister);
}
