// Aws Sms tests cover send plugin behavior.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendTextViaAws = vi.hoisted(() =>
  vi.fn(async ({ to }: { to: string }) => ({
    messageId: "msg-123",
    to,
    from: "+15551234567",
  })),
);

const sendMediaViaAws = vi.hoisted(() =>
  vi.fn(async ({ to }: { to: string }) => ({
    messageId: "msg-media-123",
    to,
    from: "+15551234567",
  })),
);

const stageAwsSmsMediaForSend = vi.hoisted(() =>
  vi.fn(async () => ({
    s3Uri: "s3://bucket/openclaw/outbound/test.jpg",
    contentType: "image/jpeg",
  })),
);

beforeEach(() => {
  vi.resetModules();
  sendTextViaAws.mockClear();
  sendMediaViaAws.mockClear();
  stageAwsSmsMediaForSend.mockClear();
  vi.doMock("./aws-client.js", () => ({
    createAwsSmsClients: vi.fn(() => ({
      sms: {},
      sns: {},
      s3: { send: vi.fn() },
    })),
  }));
  vi.doMock("./aws-sms.js", () => ({
    sendTextViaAws,
    sendMediaViaAws,
  }));
  vi.doMock("./media.js", () => ({
    stageAwsSmsMediaForSend,
  }));
});

afterEach(() => {
  vi.doUnmock("./aws-client.js");
  vi.doUnmock("./aws-sms.js");
  vi.doUnmock("./media.js");
});

describe("sendAwsSmsTextChunks", () => {
  it("chunks and sends plain text", async () => {
    const { sendAwsSmsTextChunks } = await import("./send.js");
    const account = {
      accountId: "default",
      enabled: true,
      region: "us-east-1",
      originationIdentity: "+15551234567",
      fromNumber: "+15551234567",
      inboundSnsTopicArn: "arn:aws:sns:us-east-1:123456789012:topic",
      mediaBucket: "bucket",
      defaultTo: "",
      webhookPath: "/webhooks/aws-sms",
      publicWebhookUrl: "https://gateway.example.com/webhooks/aws-sms",
      autoConfirmSnsSubscription: false,
      dmPolicy: "pairing" as const,
      allowFrom: [],
      textChunkLimit: 10,
      mediaMaxMb: 0.6,
    };
    const results = await sendAwsSmsTextChunks({
      account,
      to: "+15557654321",
      text: "alpha beta gamma delta",
    });
    expect(results.length).toBeGreaterThan(1);
    expect(sendTextViaAws).toHaveBeenCalledTimes(results.length);
  });
});

describe("sendAwsSmsMedia", () => {
  it("stages media and sends MMS", async () => {
    const { sendAwsSmsMedia } = await import("./send.js");
    const account = {
      accountId: "default",
      enabled: true,
      region: "us-east-1",
      originationIdentity: "+15551234567",
      fromNumber: "+15551234567",
      inboundSnsTopicArn: "arn:aws:sns:us-east-1:123456789012:topic",
      mediaBucket: "bucket",
      defaultTo: "",
      webhookPath: "/webhooks/aws-sms",
      publicWebhookUrl: "https://gateway.example.com/webhooks/aws-sms",
      autoConfirmSnsSubscription: false,
      dmPolicy: "pairing" as const,
      allowFrom: [],
      textChunkLimit: 1500,
      mediaMaxMb: 0.6,
    };
    const result = await sendAwsSmsMedia({
      account,
      to: "+15557654321",
      text: "photo",
      mediaUrl: "https://example.com/image.jpg",
    });
    expect(stageAwsSmsMediaForSend).toHaveBeenCalledOnce();
    expect(sendMediaViaAws).toHaveBeenCalledOnce();
    expect(result.messageId).toBe("msg-media-123");
  });
});
