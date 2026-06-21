// Aws Sms helper module supports config schema behavior.
import {
  AllowFromListSchema,
  buildChannelConfigSchema,
  DmPolicySchema,
  requireOpenAllowFrom,
} from "openclaw/plugin-sdk/channel-config-primitives";
import { requireChannelOpenAllowFrom } from "openclaw/plugin-sdk/extension-shared";
import { z } from "zod";

const AwsSmsAccountConfigSchema = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    region: z.string().optional(),
    originationIdentity: z.string().optional(),
    fromNumber: z.string().optional(),
    inboundSnsTopicArn: z.string().optional(),
    mediaBucket: z.string().optional(),
    defaultTo: z.string().optional(),
    webhookPath: z.string().optional(),
    publicWebhookUrl: z.string().optional(),
    autoConfirmSnsSubscription: z.boolean().optional(),
    dmPolicy: DmPolicySchema.optional().default("pairing"),
    allowFrom: AllowFromListSchema,
    textChunkLimit: z.number().int().positive().optional(),
    mediaMaxMb: z.number().positive().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    requireChannelOpenAllowFrom({
      channel: "aws-sms",
      policy: value.dmPolicy,
      allowFrom: value.allowFrom,
      ctx,
      requireOpenAllowFrom,
    });
  });

export const AwsSmsConfigSchema = AwsSmsAccountConfigSchema.extend({
  accounts: z.record(z.string(), AwsSmsAccountConfigSchema.optional()).optional(),
  defaultAccount: z.string().optional(),
});

export const AwsSmsChannelConfigSchema = buildChannelConfigSchema(AwsSmsConfigSchema, {
  uiHints: {
    "": {
      label: "AWS SMS",
      help: "AWS End User Messaging SMS channel for outbound text/MMS and SNS inbound webhooks.",
    },
    region: {
      label: "AWS Region",
      help: "AWS region for End User Messaging SMS resources. Falls back to AWS_REGION when unset.",
    },
    originationIdentity: {
      label: "Origination Identity",
      help: "E.164 phone number, phone-number id/ARN, or pool id/ARN used for outbound SMS/MMS.",
    },
    fromNumber: {
      label: "From Number",
      help: "Normalized E.164 sender used for probes, pairing labels, and UI display.",
    },
    inboundSnsTopicArn: {
      label: "Inbound SNS Topic ARN",
      help: "SNS topic that receives two-way SMS payloads from AWS End User Messaging SMS.",
    },
    mediaBucket: {
      label: "MMS Media Bucket",
      help: "S3 bucket in the same AWS account and region as the origination identity for outbound MMS staging.",
    },
    publicWebhookUrl: {
      label: "Public Webhook URL",
      help: "Public HTTPS URL subscribed to the inbound SNS topic. Must match the gateway route exactly.",
    },
    webhookPath: {
      label: "Webhook Path",
      help: "Gateway HTTP path for SNS HTTPS subscriptions. Use a distinct path per account.",
    },
    autoConfirmSnsSubscription: {
      label: "Auto Confirm SNS Subscription",
      help: "When true, the gateway confirms SNS HTTPS subscription handshakes automatically.",
    },
    dmPolicy: {
      label: "AWS SMS DM Policy",
      help: 'Direct SMS access control ("pairing" recommended). "open" requires channels.aws-sms.allowFrom=["*"].',
    },
    allowFrom: {
      label: "AWS SMS Allow From",
      help: "Allowed sender phone numbers in E.164 format, or * when dmPolicy is open.",
    },
    textChunkLimit: {
      label: "Text Chunk Limit",
      help: "Maximum characters per outbound SMS chunk before OpenClaw splits long replies.",
    },
    mediaMaxMb: {
      label: "Media Max MB",
      help: "Maximum outbound MMS media size per file before send (AWS MMS limit is 600 KB).",
    },
  },
});
