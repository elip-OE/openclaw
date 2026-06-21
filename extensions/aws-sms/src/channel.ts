// Aws Sms plugin module implements channel behavior.
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import type { OpenClawConfig } from "openclaw/plugin-sdk/account-resolution";
import {
  createHybridChannelConfigAdapter,
  createScopedDmSecurityResolver,
} from "openclaw/plugin-sdk/channel-config-helpers";
import { createChatChannelPlugin, type ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { createConditionalWarningCollector } from "openclaw/plugin-sdk/channel-policy";
import { attachChannelToResult } from "openclaw/plugin-sdk/channel-send-result";
import { createEmptyChannelDirectoryAdapter } from "openclaw/plugin-sdk/directory-runtime";
import { normalizeStringEntries } from "openclaw/plugin-sdk/string-coerce-runtime";
import { chunkTextForOutbound } from "openclaw/plugin-sdk/text-chunking";
import {
  inspectAwsSmsAccount,
  isAwsSmsAccountConfigured,
  listAwsSmsAccountIds,
  resolveAwsSmsAccount,
  resolveDefaultAwsSmsAccountId,
} from "./accounts.js";
import { createAwsSmsTool } from "./agent-tools.js";
import { AwsSmsChannelConfigSchema } from "./config-schema.js";
import { collectAwsSmsDoctorHints, collectAwsSmsStartupWarnings } from "./doctor.js";
import { startAwsSmsGatewayAccount } from "./gateway.js";
import {
  looksLikeAwsSmsPhoneNumber,
  normalizeAwsSmsAllowFrom,
  normalizeAwsSmsPhoneNumber,
} from "./phone.js";
import { sendAwsSmsMedia, sendAwsSmsTextChunks, toAwsSmsPlainText } from "./send.js";
import { formatAwsSmsProbeLines, probeAwsSmsAccount, type AwsSmsProbe } from "./status.js";
import type { ResolvedAwsSmsAccount } from "./types.js";

const CHANNEL_ID = "aws-sms";

const awsSmsConfigAdapter = createHybridChannelConfigAdapter<ResolvedAwsSmsAccount>({
  sectionKey: CHANNEL_ID,
  listAccountIds: listAwsSmsAccountIds,
  resolveAccount: resolveAwsSmsAccount,
  defaultAccountId: resolveDefaultAwsSmsAccountId,
  clearBaseFields: [
    "region",
    "originationIdentity",
    "fromNumber",
    "inboundSnsTopicArn",
    "mediaBucket",
    "defaultTo",
    "webhookPath",
    "publicWebhookUrl",
    "autoConfirmSnsSubscription",
    "dmPolicy",
    "allowFrom",
    "textChunkLimit",
    "mediaMaxMb",
  ],
  resolveAllowFrom: (account) => account.allowFrom,
  formatAllowFrom: (allowFrom) =>
    normalizeStringEntries(allowFrom.map((entry) => normalizeAwsSmsAllowFrom(String(entry)))),
  resolveDefaultTo: (account) => account.defaultTo,
});

const resolveAwsSmsDmPolicy = createScopedDmSecurityResolver<ResolvedAwsSmsAccount>({
  channelKey: CHANNEL_ID,
  resolvePolicy: (account) => account.dmPolicy,
  resolveAllowFrom: (account) => account.allowFrom,
  policyPathSuffix: "dmPolicy",
  defaultPolicy: "pairing",
  approveHint: "openclaw pairing approve aws-sms <code>",
  normalizeEntry: normalizeAwsSmsAllowFrom,
});

const collectAwsSmsSecurityWarnings = createConditionalWarningCollector<ResolvedAwsSmsAccount>(
  (account) =>
    account.dmPolicy === "open" &&
    account.allowFrom.includes("*") &&
    '- AWS SMS: dmPolicy="open" allows any phone number to message the bot.',
  (account) =>
    !account.mediaBucket &&
    "- AWS SMS: mediaBucket is not configured. Outbound MMS sends will fail until the bucket is created.",
);

function awsSmsSetupPatch(input: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of [
    "region",
    "originationIdentity",
    "fromNumber",
    "inboundSnsTopicArn",
    "mediaBucket",
    "defaultTo",
    "webhookPath",
    "publicWebhookUrl",
    "autoConfirmSnsSubscription",
    "dmPolicy",
    "allowFrom",
    "textChunkLimit",
    "mediaMaxMb",
  ]) {
    if (input[key] !== undefined) {
      patch[key] = input[key];
    }
  }
  return patch;
}

function applyAwsSmsAccountConfig(params: {
  cfg: OpenClawConfig;
  accountId: string;
  input: Record<string, unknown>;
}): OpenClawConfig {
  const patch = awsSmsSetupPatch(params.input);
  const channels = { ...params.cfg.channels };
  const current = { ...(channels[CHANNEL_ID] as Record<string, unknown> | undefined) };
  if (params.accountId === DEFAULT_ACCOUNT_ID) {
    channels[CHANNEL_ID] = { ...current, ...patch };
    return { ...params.cfg, channels };
  }
  const accounts = { ...(current.accounts as Record<string, unknown> | undefined) };
  accounts[params.accountId] = {
    ...(accounts[params.accountId] as Record<string, unknown> | undefined),
    ...patch,
  };
  channels[CHANNEL_ID] = { ...current, accounts };
  return { ...params.cfg, channels };
}

export function resolveAwsSmsTextChunkLimit(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  fallbackLimit?: number;
}): number {
  return (
    resolveAwsSmsAccount(params.cfg, params.accountId).textChunkLimit ||
    params.fallbackLimit ||
    1500
  );
}

async function sendAwsSmsText(ctx: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  to: string;
  text: string;
}) {
  const account = resolveAwsSmsAccount(ctx.cfg, ctx.accountId);
  const to = normalizeAwsSmsPhoneNumber(ctx.to) || account.defaultTo;
  if (!looksLikeAwsSmsPhoneNumber(to)) {
    throw new Error(`Invalid AWS SMS target: ${ctx.to}`);
  }
  const results = await sendAwsSmsTextChunks({ account, to, text: ctx.text });
  const first = results[0];
  if (!first) {
    throw new Error("AWS SMS send did not return a MessageId.");
  }
  return attachChannelToResult(CHANNEL_ID, { messageId: first.messageId, chatId: first.to });
}

async function sendAwsSmsMediaMessage(ctx: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  to: string;
  text?: string;
  mediaUrl: string;
  mediaLocalRoots?: readonly string[] | "any";
  mediaReadFile?: (filePath: string) => Promise<Buffer>;
  workspaceDir?: string;
}) {
  const account = resolveAwsSmsAccount(ctx.cfg, ctx.accountId);
  const to = normalizeAwsSmsPhoneNumber(ctx.to) || account.defaultTo;
  if (!looksLikeAwsSmsPhoneNumber(to)) {
    throw new Error(`Invalid AWS SMS target: ${ctx.to}`);
  }
  const result = await sendAwsSmsMedia({
    account,
    to,
    text: ctx.text,
    mediaUrl: ctx.mediaUrl,
    mediaLocalRoots: ctx.mediaLocalRoots,
    mediaReadFile: ctx.mediaReadFile,
    workspaceDir: ctx.workspaceDir,
  });
  return attachChannelToResult(CHANNEL_ID, { messageId: result.messageId, chatId: result.to });
}

export const awsSmsPlugin: ChannelPlugin<ResolvedAwsSmsAccount, AwsSmsProbe> =
  createChatChannelPlugin({
    base: {
      id: CHANNEL_ID,
      meta: {
        id: CHANNEL_ID,
        label: "AWS SMS",
        selectionLabel: "AWS SMS",
        detailLabel: "AWS End User Messaging SMS",
        docsPath: "/channels/aws-sms",
        docsLabel: "aws-sms",
        blurb: "AWS End User Messaging SMS with SNS inbound webhooks and MMS outbound.",
        order: 87,
      },
      capabilities: {
        chatTypes: ["direct"],
        media: true,
        threads: false,
        reactions: false,
        edit: false,
        unsend: false,
        reply: false,
        effects: false,
        blockStreaming: false,
      },
      reload: { configPrefixes: [`channels.${CHANNEL_ID}`] },
      configSchema: AwsSmsChannelConfigSchema,
      setup: {
        applyAccountConfig: applyAwsSmsAccountConfig,
      },
      config: {
        ...awsSmsConfigAdapter,
        inspectAccount: inspectAwsSmsAccount,
        isConfigured: isAwsSmsAccountConfigured,
        unconfiguredReason: () =>
          "AWS SMS requires region, originationIdentity, and fromNumber (or AWS_REGION and AWS_SMS_* env vars).",
        describeAccount: (account) => ({
          accountId: account.accountId,
          name: account.fromNumber || account.originationIdentity || "AWS SMS",
          configured: isAwsSmsAccountConfigured(account),
          enabled: account.enabled,
        }),
      },
      messaging: {
        targetPrefixes: ["aws-sms"],
        normalizeTarget: (target) => normalizeAwsSmsPhoneNumber(target),
        targetResolver: {
          looksLikeId: looksLikeAwsSmsPhoneNumber,
          hint: "<+15551234567>",
        },
      },
      directory: createEmptyChannelDirectoryAdapter(),
      gateway: {
        startAccount: async (ctx) =>
          await startAwsSmsGatewayAccount({
            cfg: ctx.cfg,
            account: ctx.account,
            abortSignal: ctx.abortSignal,
            log: ctx.log,
          }),
      },
      status: {
        buildAccountSnapshot: ({ account }) => {
          const configured = isAwsSmsAccountConfigured(account);
          return {
            accountId: account.accountId,
            name: account.fromNumber || account.originationIdentity || "AWS SMS",
            enabled: account.enabled,
            configured,
            statusState: !account.enabled ? "disabled" : configured ? "configured" : "unconfigured",
          };
        },
        probeAccount: async ({ account, timeoutMs }) =>
          await probeAwsSmsAccount({ account, timeoutMs }),
        formatCapabilitiesProbe: ({ probe }) => formatAwsSmsProbeLines(probe),
        buildCapabilitiesDiagnostics: async ({ account }) => ({
          lines: [
            ...collectAwsSmsStartupWarnings(account).map((text) => ({
              text,
              tone: "warn" as const,
            })),
            ...collectAwsSmsDoctorHints(account).map((text) => ({ text, tone: "warn" as const })),
          ],
        }),
      },
      agentTools: ({ cfg }) => [createAwsSmsTool(cfg)],
      agentPrompt: {
        messageToolHints: () => [
          "",
          "### AWS SMS Formatting",
          "AWS SMS is plain text for inbound messages. Keep replies brief and avoid markdown tables.",
          "Outbound MMS is US/Canada only, requires an MMS-capable origination identity, and uses the configured S3 media bucket.",
          "AWS does not deliver inbound MMS media on SNS; inbound remains text-only even after outbound MMS.",
        ],
      },
    },
    pairing: {
      text: {
        idLabel: "phoneNumber",
        message: "OpenClaw: your AWS SMS access has been approved.",
        normalizeAllowEntry: normalizeAwsSmsAllowFrom,
        notify: async ({ cfg, id, message, accountId }) => {
          const account = resolveAwsSmsAccount(cfg, accountId);
          await sendAwsSmsTextChunks({
            account,
            to: normalizeAwsSmsPhoneNumber(id),
            text: message,
          });
        },
      },
    },
    security: {
      resolveDmPolicy: resolveAwsSmsDmPolicy,
      collectWarnings: ({ account }) => collectAwsSmsSecurityWarnings(account),
    },
    outbound: {
      deliveryMode: "gateway",
      chunker: chunkTextForOutbound,
      chunkerMode: "text",
      textChunkLimit: 1500,
      resolveEffectiveTextChunkLimit: resolveAwsSmsTextChunkLimit,
      resolveTarget: ({ cfg, to, accountId }) => {
        const explicit = normalizeAwsSmsPhoneNumber(to ?? "");
        if (explicit) {
          return { ok: true, to: explicit };
        }
        if (cfg) {
          const account = resolveAwsSmsAccount(cfg, accountId);
          if (account.defaultTo) {
            return { ok: true, to: account.defaultTo };
          }
        }
        return { ok: false, error: new Error("AWS SMS target must be an E.164 phone number.") };
      },
      sanitizeText: ({ text }) => toAwsSmsPlainText(text),
      sendText: sendAwsSmsText,
      sendMedia: sendAwsSmsMediaMessage,
    },
  });
