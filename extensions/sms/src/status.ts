// Twilio SMS status/probe.
import { listTwilioIncomingPhoneNumbers, listTwilioMessages, type TwilioIncomingPhoneNumber, type TwilioMessageLogEntry } from "./twilio.js";
import type { ResolvedSmsAccount } from "./types.js";

const TWILIO_ERROR_WEBHOOK_REACHABILITY = "11200";

type CapLine = { text: string; tone?: "default" | "muted" | "success" | "warn" | "error" };

export type SmsTwilioWebhookProbe =
  | { status: "skipped"; reason: string }
  | { status: "number-not-found"; expectedNumber: string }
  | { status: "missing"; phoneNumber: string; expectedUrl: string; configuredMethod: string }
  | { status: "method-mismatch"; phoneNumber: string; expectedUrl: string; configuredUrl: string; configuredMethod: string }
  | { status: "url-mismatch"; phoneNumber: string; expectedUrl: string; configuredUrl: string; configuredMethod: string }
  | { status: "matches"; phoneNumber: string; expectedUrl: string; configuredUrl: string; configuredMethod: string; voiceUrl: string };

export type SmsProbe = {
  ok: boolean;
  error?: string;
  webhook: SmsTwilioWebhookProbe;
  recentInbound?: Pick<TwilioMessageLogEntry, "sid" | "direction" | "status" | "errorCode" | "dateCreated" | "dateSent">;
  hints: string[];
};

function compareTwilioWebhook(account: ResolvedSmsAccount, phoneNumber: TwilioIncomingPhoneNumber | undefined): SmsTwilioWebhookProbe {
  if (!account.fromNumber) return { status: "skipped", reason: "Messaging Service senders do not have one phone-number SMS webhook to inspect." };
  if (!phoneNumber) return { status: "number-not-found", expectedNumber: account.fromNumber };
  const method = phoneNumber.smsMethod.toUpperCase();
  if (!phoneNumber.smsUrl) return { status: "missing", phoneNumber: phoneNumber.phoneNumber || account.fromNumber, expectedUrl: account.publicWebhookUrl, configuredMethod: method };
  if (method && method !== "POST") return { status: "method-mismatch", phoneNumber: phoneNumber.phoneNumber || account.fromNumber, expectedUrl: account.publicWebhookUrl, configuredUrl: phoneNumber.smsUrl, configuredMethod: method };
  if (phoneNumber.smsUrl !== account.publicWebhookUrl) return { status: "url-mismatch", phoneNumber: phoneNumber.phoneNumber || account.fromNumber, expectedUrl: account.publicWebhookUrl, configuredUrl: phoneNumber.smsUrl, configuredMethod: method };
  return { status: "matches", phoneNumber: phoneNumber.phoneNumber || account.fromNumber, expectedUrl: account.publicWebhookUrl, configuredUrl: phoneNumber.smsUrl, configuredMethod: method, voiceUrl: phoneNumber.voiceUrl };
}

function webhookError(probe: SmsTwilioWebhookProbe): string | undefined {
  switch (probe.status) {
    case "matches": case "skipped": return undefined;
    case "number-not-found": return `Twilio account does not list ${probe.expectedNumber}.`;
    case "missing": return `Twilio number ${probe.phoneNumber} has no SMS webhook URL configured.`;
    case "method-mismatch": return `Twilio number ${probe.phoneNumber} uses ${probe.configuredMethod} for SMS webhooks; use POST.`;
    case "url-mismatch": return `Twilio number ${probe.phoneNumber} points SMS webhooks at ${probe.configuredUrl}; expected ${probe.expectedUrl}.`;
  }
  return undefined;
}

export async function probeSmsAccount(params: { account: ResolvedSmsAccount; timeoutMs: number }): Promise<SmsProbe> {
  const hints: string[] = [];
  const webhook: SmsTwilioWebhookProbe = params.account.fromNumber
    ? compareTwilioWebhook(params.account, (await listTwilioIncomingPhoneNumbers({ account: params.account, phoneNumber: params.account.fromNumber, timeoutMs: params.timeoutMs }))[0])
    : { status: "skipped", reason: "Twilio SMS probe requires fromNumber." };
  const messages = params.account.fromNumber
    ? await listTwilioMessages({ account: params.account, to: params.account.fromNumber, pageSize: 3, timeoutMs: params.timeoutMs })
    : [];
  const recentInbound = messages[0] ? {
    sid: messages[0].sid, direction: messages[0].direction, status: messages[0].status,
    errorCode: messages[0].errorCode, dateCreated: messages[0].dateCreated, dateSent: messages[0].dateSent,
  } : undefined;
  if (recentInbound?.errorCode === TWILIO_ERROR_WEBHOOK_REACHABILITY) {
    hints.push("Twilio error 11200 means Twilio could not reach the SMS webhook.");
  }
  const error = webhookError(webhook) ?? (recentInbound?.errorCode === TWILIO_ERROR_WEBHOOK_REACHABILITY ? `Recent inbound SMS ${recentInbound.sid} has Twilio error 11200.` : undefined);
  return { ok: !error, ...(error ? { error } : {}), webhook, ...(recentInbound ? { recentInbound } : {}), hints };
}

export function formatSmsProbeLines(probe: unknown): CapLine[] {
  if (!probe || typeof probe !== "object") return [];
  const p = probe as Partial<SmsProbe>;
  const lines: CapLine[] = [];
  if (p.ok === true) lines.push({ text: "Probe: ok", tone: "success" });
  else if (p.ok === false) lines.push({ text: `Probe: failed${p.error ? ` (${p.error})` : ""}`, tone: "error" });
  if (p.webhook?.status === "matches") lines.push({ text: `Twilio SMS webhook: ${p.webhook.configuredUrl}` });
  else if (p.webhook?.status && p.webhook.status !== "skipped") lines.push({ text: `Twilio SMS webhook: ${p.webhook.status}`, tone: "warn" });
  if (p.recentInbound?.sid) {
    const error = p.recentInbound.errorCode ? ` error=${p.recentInbound.errorCode}` : "";
    lines.push({ text: `Recent inbound: ${p.recentInbound.status || "unknown"}${error}`, tone: p.recentInbound.errorCode ? "warn" : "muted" });
  }
  for (const hint of p.hints ?? []) lines.push({ text: hint, tone: "warn" });
  return lines;
}
