// Twilio SMS config schema.
import {
  AllowFromListSchema,
  buildChannelConfigSchema,
  DmPolicySchema,
  requireOpenAllowFrom,
} from "openclaw/plugin-sdk/channel-config-primitives";
import { requireChannelOpenAllowFrom } from "openclaw/plugin-sdk/extension-shared";
import { z } from "zod";

const SmsAccountFields = {
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  accountSid: z.string().optional(),
  authToken: z.string().optional(),
  fromNumber: z.string().optional(),
  messagingServiceSid: z.string().optional(),
  defaultTo: z.string().optional(),
  webhookPath: z.string().optional(),
  publicWebhookUrl: z.string().optional(),
  dangerouslyDisableSignatureValidation: z.boolean().optional(),
  dmPolicy: DmPolicySchema.optional().default("pairing"),
  allowFrom: AllowFromListSchema,
  textChunkLimit: z.number().int().positive().optional(),
};

const SmsAccountConfigSchema = z.object(SmsAccountFields).strict();

export const SmsConfigSchema = z.object({
  ...SmsAccountFields,
  accounts: z.record(z.string(), SmsAccountConfigSchema.optional()).optional(),
  defaultAccount: z.string().optional(),
}).strict();

export const SmsChannelConfigSchema = buildChannelConfigSchema(SmsConfigSchema, {
  uiHints: {
    "": { label: "SMS", help: "Twilio SMS channel configuration." },
    accountSid: { label: "Twilio Account SID", help: "Twilio Account SID." },
    authToken: { label: "Twilio Auth Token", help: "Twilio Auth Token." },
    fromNumber: { label: "SMS From Number", help: "E.164 format, e.g. +15551234567." },
    messagingServiceSid: { label: "Messaging Service SID", help: "Twilio Messaging Service SID." },
    defaultTo: { label: "Default To Number", help: "Default outbound phone number." },
    publicWebhookUrl: { label: "Public Webhook URL", help: "Public URL for Twilio webhook." },
    webhookPath: { label: "Webhook Path", help: "Gateway HTTP path for Twilio webhooks." },
    dmPolicy: { label: "DM Policy", help: 'SMS access control ("pairing" recommended).' },
    allowFrom: { label: "Allow From", help: "Allowed sender phones in E.164, or *." },
    textChunkLimit: { label: "Text Chunk Limit", help: "Max chars per outbound SMS chunk." },
  },
});
