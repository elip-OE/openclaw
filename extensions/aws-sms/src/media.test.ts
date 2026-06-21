// Aws Sms tests cover MMS media staging behavior.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadOutboundMediaFromUrl = vi.hoisted(() => vi.fn());
const s3Send = vi.hoisted(() => vi.fn(async () => ({})));

const baseAccount = {
  accountId: "default",
  enabled: true,
  region: "us-east-1",
  originationIdentity: "+15551234567",
  fromNumber: "+15551234567",
  inboundSnsTopicArn: "arn:aws:sns:us-east-1:123456789012:topic",
  mediaBucket: "openclaw-aws-sms-media",
  defaultTo: "",
  webhookPath: "/webhooks/aws-sms",
  publicWebhookUrl: "https://gateway.example.com/webhooks/aws-sms",
  autoConfirmSnsSubscription: false,
  dmPolicy: "pairing" as const,
  allowFrom: [],
  textChunkLimit: 1500,
  mediaMaxMb: 0.6,
};

beforeEach(() => {
  vi.resetModules();
  loadOutboundMediaFromUrl.mockReset();
  s3Send.mockClear();
  vi.doMock("openclaw/plugin-sdk/outbound-media", () => ({
    loadOutboundMediaFromUrl,
  }));
  vi.doMock("./aws-client.js", () => ({
    createAwsSmsClients: vi.fn(() => ({
      sms: {},
      sns: {},
      s3: { send: s3Send },
    })),
  }));
});

afterEach(() => {
  vi.doUnmock("openclaw/plugin-sdk/outbound-media");
  vi.doUnmock("./aws-client.js");
});

describe("stageAwsSmsMediaForSend", () => {
  it("rejects unsupported content types", async () => {
    loadOutboundMediaFromUrl.mockResolvedValue({
      buffer: Buffer.from("pdf"),
      contentType: "application/pdf",
    });
    const { stageAwsSmsMediaForSend } = await import("./media.js");
    await expect(
      stageAwsSmsMediaForSend({
        account: baseAccount,
        mediaUrl: "https://example.com/file.pdf",
      }),
    ).rejects.toThrow(/does not support content type application\/pdf/);
    expect(s3Send).not.toHaveBeenCalled();
  });

  it("rejects media larger than the configured limit", async () => {
    loadOutboundMediaFromUrl.mockResolvedValue({
      buffer: Buffer.alloc(700 * 1024),
      contentType: "image/jpeg",
    });
    const { stageAwsSmsMediaForSend } = await import("./media.js");
    await expect(
      stageAwsSmsMediaForSend({
        account: { ...baseAccount, mediaMaxMb: 0.5 },
        mediaUrl: "https://example.com/large.jpg",
      }),
    ).rejects.toThrow(/exceeds \d+ bytes/);
    expect(s3Send).not.toHaveBeenCalled();
  });

  it("uploads supported media to S3 and returns an s3 URI", async () => {
    loadOutboundMediaFromUrl.mockResolvedValue({
      buffer: Buffer.from("jpeg-bytes"),
      contentType: "image/jpeg",
    });
    const { stageAwsSmsMediaForSend } = await import("./media.js");
    const result = await stageAwsSmsMediaForSend({
      account: baseAccount,
      mediaUrl: "https://example.com/image.jpg",
    });
    expect(result.contentType).toBe("image/jpeg");
    expect(result.s3Uri).toMatch(/^s3:\/\/openclaw-aws-sms-media\/openclaw\/outbound\//);
    expect(s3Send).toHaveBeenCalledOnce();
  });

  it("requires mediaBucket", async () => {
    const { stageAwsSmsMediaForSend } = await import("./media.js");
    await expect(
      stageAwsSmsMediaForSend({
        account: { ...baseAccount, mediaBucket: "" },
        mediaUrl: "https://example.com/image.jpg",
      }),
    ).rejects.toThrow(/mediaBucket/);
  });
});
