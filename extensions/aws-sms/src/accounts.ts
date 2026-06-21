// Aws Sms plugin module implements accounts behavior.
import { normalizeOptionalAccountId } from "openclaw/plugin-sdk/account-id";
import {
  DEFAULT_ACCOUNT_ID,
  listCombinedAccountIds,
  resolveAccountEntry,
  resolveListedDefaultAccountId,
  resolveMergedAccountConfig,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/account-resolution";
import { parseStrictInteger } from "openclaw/plugin-sdk/number-runtime";
import { normalizeStringEntries } from "openclaw/plugin-sdk/string-coerce-runtime";
import { normalizeAwsSmsAllowFrom, normalizeAwsSmsPhoneNumber } from "./phone.js";
import type { AwsSmsChannelConfig, ResolvedAwsSmsAccount } from "./types.js";

const CHANNEL_ID = "aws-sms";
const DEFAULT_WEBHOOK_PATH = "/webhooks/aws-sms";
const DEFAULT_TEXT_CHUNK_LIMIT = 1500;
const DEFAULT_MEDIA_MAX_MB = 0.6;

function getChannelConfig(cfg: OpenClawConfig): AwsSmsChannelConfig | undefined {
  return cfg?.channels?.[CHANNEL_ID] as AwsSmsChannelConfig | undefined;
}

function parseList(raw: unknown): string[] {
  if (!raw) {
    return [];
  }
  const entries = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? normalizeStringEntries(raw.split(","))
      : [raw];
  return entries.map((entry) => normalizeAwsSmsAllowFrom(String(entry))).filter(Boolean);
}

function parseTextChunkLimit(raw: unknown): number {
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0) {
    return raw;
  }
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    return parseStrictInteger(raw.trim()) ?? DEFAULT_TEXT_CHUNK_LIMIT;
  }
  return DEFAULT_TEXT_CHUNK_LIMIT;
}

function parseMediaMaxMb(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  if (typeof raw === "string" && /^\d+(\.\d+)?$/.test(raw.trim())) {
    const parsed = Number(raw.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MEDIA_MAX_MB;
  }
  return DEFAULT_MEDIA_MAX_MB;
}

function resolveRegion(mergedRegion: unknown, useEnvFallbacks: boolean): string {
  const configured = typeof mergedRegion === "string" ? mergedRegion.trim() : "";
  if (configured) {
    return configured;
  }
  if (useEnvFallbacks) {
    return (process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "").trim();
  }
  return "";
}

function hasBaseAccount(channelCfg: AwsSmsChannelConfig | undefined): boolean {
  return Boolean(
    channelCfg?.region ||
    channelCfg?.originationIdentity ||
    channelCfg?.fromNumber ||
    channelCfg?.inboundSnsTopicArn ||
    process.env.AWS_SMS_ORIGINATION_IDENTITY ||
    process.env.AWS_SMS_FROM_NUMBER ||
    process.env.AWS_SMS_INBOUND_TOPIC_ARN,
  );
}

export function listAwsSmsAccountIds(cfg: OpenClawConfig): string[] {
  const channelCfg = getChannelConfig(cfg);
  return listCombinedAccountIds({
    configuredAccountIds: Object.keys(channelCfg?.accounts ?? {}),
    implicitAccountId: hasBaseAccount(channelCfg) ? DEFAULT_ACCOUNT_ID : undefined,
  });
}

export function resolveDefaultAwsSmsAccountId(cfg: OpenClawConfig): string {
  const channelCfg = getChannelConfig(cfg);
  return resolveListedDefaultAccountId({
    accountIds: listAwsSmsAccountIds(cfg),
    configuredDefaultAccountId: normalizeOptionalAccountId(channelCfg?.defaultAccount),
  });
}

export function resolveAwsSmsAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): ResolvedAwsSmsAccount {
  const channelCfg = getChannelConfig(cfg) ?? {};
  const id = normalizeOptionalAccountId(accountId) ?? resolveDefaultAwsSmsAccountId(cfg);
  const accountConfig = resolveAccountEntry(channelCfg.accounts, id);
  const channelConfig: Record<string, unknown> & AwsSmsChannelConfig = { ...channelCfg };
  const accountEntries:
    | Record<string, Partial<Record<string, unknown> & AwsSmsChannelConfig>>
    | undefined = channelCfg.accounts
    ? Object.fromEntries(
        Object.entries(channelCfg.accounts).map(([accountKey, account]) => [
          accountKey,
          { ...account },
        ]),
      )
    : undefined;
  const merged = resolveMergedAccountConfig<Record<string, unknown> & AwsSmsChannelConfig>({
    channelConfig,
    accounts: accountEntries,
    accountId: id,
    omitKeys: ["defaultAccount"],
  });

  const useEnvFallbacks = id === DEFAULT_ACCOUNT_ID;
  const envOriginationIdentity = useEnvFallbacks
    ? process.env.AWS_SMS_ORIGINATION_IDENTITY
    : undefined;
  const envFromNumber = useEnvFallbacks ? process.env.AWS_SMS_FROM_NUMBER : undefined;
  const envInboundTopicArn = useEnvFallbacks ? process.env.AWS_SMS_INBOUND_TOPIC_ARN : undefined;
  const envMediaBucket = useEnvFallbacks ? process.env.AWS_SMS_MEDIA_BUCKET : undefined;
  const envWebhookPath = useEnvFallbacks ? process.env.AWS_SMS_WEBHOOK_PATH : undefined;
  const envPublicWebhookUrl = useEnvFallbacks ? process.env.AWS_SMS_PUBLIC_WEBHOOK_URL : undefined;
  const envAllowFrom = useEnvFallbacks ? process.env.AWS_SMS_ALLOWED_USERS : undefined;
  const envTextChunkLimit = useEnvFallbacks ? process.env.AWS_SMS_TEXT_CHUNK_LIMIT : undefined;
  const envMediaMaxMb = useEnvFallbacks ? process.env.AWS_SMS_MEDIA_MAX_MB : undefined;

  const webhookPath = (merged.webhookPath ?? envWebhookPath ?? DEFAULT_WEBHOOK_PATH).trim();
  const publicWebhookUrl = (merged.publicWebhookUrl ?? envPublicWebhookUrl ?? "").trim();

  return {
    accountId: id,
    enabled: channelCfg.enabled !== false && accountConfig?.enabled !== false,
    region: resolveRegion(merged.region, useEnvFallbacks),
    originationIdentity: (merged.originationIdentity ?? envOriginationIdentity ?? "").trim(),
    fromNumber: normalizeAwsSmsPhoneNumber(merged.fromNumber ?? envFromNumber ?? ""),
    inboundSnsTopicArn: (merged.inboundSnsTopicArn ?? envInboundTopicArn ?? "").trim(),
    mediaBucket: (merged.mediaBucket ?? envMediaBucket ?? "").trim(),
    defaultTo: normalizeAwsSmsPhoneNumber(merged.defaultTo ?? ""),
    webhookPath: webhookPath || DEFAULT_WEBHOOK_PATH,
    publicWebhookUrl,
    autoConfirmSnsSubscription: merged.autoConfirmSnsSubscription === true,
    dmPolicy: merged.dmPolicy ?? "pairing",
    allowFrom: parseList(merged.allowFrom ?? envAllowFrom),
    textChunkLimit: parseTextChunkLimit(merged.textChunkLimit ?? envTextChunkLimit),
    mediaMaxMb: parseMediaMaxMb(merged.mediaMaxMb ?? envMediaMaxMb),
  };
}

export function inspectAwsSmsAccount(cfg: OpenClawConfig, accountId?: string | null) {
  const account = resolveAwsSmsAccount(cfg, accountId);
  const configured = isAwsSmsAccountConfigured(account);
  return {
    enabled: account.enabled,
    configured,
    region: account.region || "missing",
    webhookPath: account.webhookPath,
    inboundTopic: account.inboundSnsTopicArn ? "configured" : "missing",
    mediaBucket: account.mediaBucket ? "configured" : "missing",
  };
}

export function isAwsSmsAccountConfigured(account: ResolvedAwsSmsAccount): boolean {
  return Boolean(account.region && account.originationIdentity && account.fromNumber);
}
