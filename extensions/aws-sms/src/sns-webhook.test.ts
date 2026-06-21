// Aws Sms tests cover sns webhook plugin behavior.
import { describe, expect, it } from "vitest";
import {
  parseAwsSmsInboundFromSnsMessage,
  parseSnsEnvelope,
  parseSnsWebhookBody,
} from "./sns-webhook.js";

const sampleInbound = {
  originationNumber: "+14255550182",
  destinationNumber: "+12125550101",
  messageKeyword: "JOIN",
  messageBody: "hello aws sms",
  inboundMessageId: "cae173d2-66b9-564c-8309-21f858e9fb84",
  previousPublishedMessageId: "null",
};

describe("parseAwsSmsInboundFromSnsMessage", () => {
  it("parses AWS two-way SMS payload", () => {
    expect(parseAwsSmsInboundFromSnsMessage(JSON.stringify(sampleInbound))).toEqual({
      from: "+14255550182",
      to: "+12125550101",
      body: "hello aws sms",
      messageId: "cae173d2-66b9-564c-8309-21f858e9fb84",
    });
  });
});

describe("parseSnsWebhookBody", () => {
  it("parses notification payloads", () => {
    const envelope = {
      Type: "Notification",
      MessageId: "sns-1",
      TopicArn: "arn:aws:sns:us-east-1:123456789012:topic",
      Timestamp: "2026-06-21T12:00:00.000Z",
      SignatureVersion: "1",
      Signature: "abc",
      SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
      Message: JSON.stringify(sampleInbound),
    };
    const parsed = parseSnsWebhookBody(JSON.stringify(envelope));
    expect(parsed.kind).toBe("notification");
    if (parsed.kind === "notification") {
      expect(parsed.inbound.body).toBe("hello aws sms");
    }
  });

  it("detects subscription confirmation payloads", () => {
    const envelope = {
      Type: "SubscriptionConfirmation",
      MessageId: "sns-2",
      TopicArn: "arn:aws:sns:us-east-1:123456789012:topic",
      Timestamp: "2026-06-21T12:00:00.000Z",
      SignatureVersion: "1",
      Signature: "abc",
      SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
      Message: "confirm",
      Token: "token",
      SubscribeURL: "https://sns.us-east-1.amazonaws.com/subscribe",
    };
    expect(parseSnsEnvelope(JSON.stringify(envelope))?.Type).toBe("SubscriptionConfirmation");
    expect(parseSnsWebhookBody(JSON.stringify(envelope)).kind).toBe("subscription_confirmation");
  });
});
