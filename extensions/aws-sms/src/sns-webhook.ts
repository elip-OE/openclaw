// Aws Sms plugin module implements SNS webhook parsing and verification.
import { createVerify, X509Certificate } from "node:crypto";
import { fetchWithSsrFGuard } from "openclaw/plugin-sdk/ssrf-runtime";
import type { AwsSmsInboundMessage } from "./types.js";

const SNS_CERT_HOST_SUFFIXES = [".amazonaws.com", ".amazonaws.com.cn"];
const CERT_CACHE_TTL_MS = 60 * 60_000;
const certCache = new Map<string, { pem: string; expiresAt: number }>();

export type SnsEnvelope = {
  Type: string;
  MessageId: string;
  TopicArn?: string;
  Subject?: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  SubscribeURL?: string;
  Token?: string;
  UnsubscribeURL?: string;
};

export type ParsedSnsWebhook =
  | { kind: "subscription_confirmation"; envelope: SnsEnvelope }
  | { kind: "unsubscribe_confirmation"; envelope: SnsEnvelope }
  | { kind: "notification"; envelope: SnsEnvelope; inbound: AwsSmsInboundMessage }
  | { kind: "unsupported"; reason: string };

function isAllowedSigningCertUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") {
      return false;
    }
    const host = url.hostname.toLowerCase();
    return SNS_CERT_HOST_SUFFIXES.some(
      (suffix) => host === suffix.slice(1) || host.endsWith(suffix),
    );
  } catch {
    return false;
  }
}

function buildStringToSign(envelope: SnsEnvelope): string {
  const fields: Array<[string, string | undefined]> =
    envelope.Type === "Notification"
      ? [
          ["Message", envelope.Message],
          ["MessageId", envelope.MessageId],
          ["Subject", envelope.Subject],
          ["Timestamp", envelope.Timestamp],
          ["TopicArn", envelope.TopicArn],
          ["Type", envelope.Type],
        ]
      : [
          ["Message", envelope.Message],
          ["MessageId", envelope.MessageId],
          ["SubscribeURL", envelope.SubscribeURL],
          ["Timestamp", envelope.Timestamp],
          ["Token", envelope.Token],
          ["TopicArn", envelope.TopicArn],
          ["Type", envelope.Type],
        ];
  return `${fields
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}\n${value}\n`)
    .join("")}`;
}

async function loadSigningCertificate(url: string, fetchImpl?: typeof fetch): Promise<string> {
  const cached = certCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.pem;
  }
  if (!isAllowedSigningCertUrl(url)) {
    throw new Error("Rejected SNS SigningCertURL outside AWS certificate hosts.");
  }
  let pem: string;
  if (fetchImpl) {
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch SNS signing certificate (${response.status}).`);
    }
    pem = await response.text();
  } else {
    const hostname = new URL(url).hostname;
    const guarded = await fetchWithSsrFGuard({
      url,
      auditContext: "aws-sms-sns-cert",
      policy: { allowedHostnames: [hostname] },
      requireHttps: true,
      timeoutMs: 10_000,
    });
    try {
      if (!guarded.response.ok) {
        throw new Error(`Failed to fetch SNS signing certificate (${guarded.response.status}).`);
      }
      pem = await guarded.response.text();
    } finally {
      await guarded.release();
    }
  }
  certCache.set(url, { pem, expiresAt: Date.now() + CERT_CACHE_TTL_MS });
  return pem;
}

export function resetSnsCertificateCacheForTest(): void {
  certCache.clear();
}

export async function verifySnsEnvelopeSignature(params: {
  envelope: SnsEnvelope;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  if (params.envelope.SignatureVersion !== "1") {
    return false;
  }
  if (!params.envelope.Signature || !params.envelope.SigningCertURL) {
    return false;
  }
  const pem = await loadSigningCertificate(params.envelope.SigningCertURL, params.fetchImpl);
  const cert = new X509Certificate(pem);
  const verifier = createVerify("RSA-SHA1");
  verifier.update(buildStringToSign(params.envelope));
  verifier.end();
  return verifier.verify(cert.publicKey, params.envelope.Signature, "base64");
}

export function parseSnsEnvelope(rawBody: string): SnsEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const type = typeof record.Type === "string" ? record.Type : "";
    const message = typeof record.Message === "string" ? record.Message : "";
    const messageId = typeof record.MessageId === "string" ? record.MessageId : "";
    const timestamp = typeof record.Timestamp === "string" ? record.Timestamp : "";
    const signatureVersion =
      typeof record.SignatureVersion === "string" ? record.SignatureVersion : "";
    const signature = typeof record.Signature === "string" ? record.Signature : "";
    const signingCertUrl = typeof record.SigningCertURL === "string" ? record.SigningCertURL : "";
    if (
      !type ||
      !message ||
      !messageId ||
      !timestamp ||
      !signatureVersion ||
      !signature ||
      !signingCertUrl
    ) {
      return null;
    }
    return {
      Type: type,
      MessageId: messageId,
      Message: message,
      Timestamp: timestamp,
      SignatureVersion: signatureVersion,
      Signature: signature,
      SigningCertURL: signingCertUrl,
      ...(typeof record.TopicArn === "string" ? { TopicArn: record.TopicArn } : {}),
      ...(typeof record.Subject === "string" ? { Subject: record.Subject } : {}),
      ...(typeof record.SubscribeURL === "string" ? { SubscribeURL: record.SubscribeURL } : {}),
      ...(typeof record.Token === "string" ? { Token: record.Token } : {}),
      ...(typeof record.UnsubscribeURL === "string"
        ? { UnsubscribeURL: record.UnsubscribeURL }
        : {}),
    };
  } catch {
    return null;
  }
}

export function parseAwsSmsInboundFromSnsMessage(message: string): AwsSmsInboundMessage | null {
  try {
    const parsed: unknown = JSON.parse(message);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const from =
      typeof record.originationNumber === "string" ? record.originationNumber.trim() : "";
    const to = typeof record.destinationNumber === "string" ? record.destinationNumber.trim() : "";
    const body = typeof record.messageBody === "string" ? record.messageBody : "";
    const messageId =
      typeof record.inboundMessageId === "string" ? record.inboundMessageId.trim() : "";
    if (!from || !to || !body || !messageId) {
      return null;
    }
    const previousPublishedMessageId =
      typeof record.previousPublishedMessageId === "string" &&
      record.previousPublishedMessageId.trim() &&
      record.previousPublishedMessageId.trim().toLowerCase() !== "null"
        ? record.previousPublishedMessageId.trim()
        : undefined;
    return {
      from,
      to,
      body,
      messageId,
      ...(previousPublishedMessageId ? { previousPublishedMessageId } : {}),
    };
  } catch {
    return null;
  }
}

export function parseSnsWebhookBody(rawBody: string): ParsedSnsWebhook {
  const envelope = parseSnsEnvelope(rawBody);
  if (!envelope) {
    return { kind: "unsupported", reason: "Invalid SNS envelope JSON." };
  }
  if (envelope.Type === "SubscriptionConfirmation") {
    return { kind: "subscription_confirmation", envelope };
  }
  if (envelope.Type === "UnsubscribeConfirmation") {
    return { kind: "unsubscribe_confirmation", envelope };
  }
  if (envelope.Type !== "Notification") {
    return { kind: "unsupported", reason: `Unsupported SNS Type ${envelope.Type}.` };
  }
  const inbound = parseAwsSmsInboundFromSnsMessage(envelope.Message);
  if (!inbound) {
    return {
      kind: "unsupported",
      reason: "SNS Notification did not contain a two-way SMS payload.",
    };
  }
  return { kind: "notification", envelope, inbound };
}

export async function confirmSnsSubscription(params: {
  topicArn: string;
  token: string;
  region: string;
}): Promise<void> {
  const { ConfirmSubscriptionCommand, SNSClient } = await import("@aws-sdk/client-sns");
  const client = new SNSClient({ region: params.region });
  await client.send(
    new ConfirmSubscriptionCommand({
      TopicArn: params.topicArn,
      Token: params.token,
    }),
  );
}
