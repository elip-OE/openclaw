// Aws Sms tests cover inbound plugin behavior.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { sendAwsSmsTextChunks as sendAwsSmsTextChunksType } from "./send.js";

const sendAwsSmsTextChunks = vi.fn<typeof sendAwsSmsTextChunksType>();

vi.mock("./send.js", () => ({
  sendAwsSmsTextChunks,
  toAwsSmsPlainText: (text: string) => text,
}));

describe("dispatchAwsSmsInboundEvent", () => {
  beforeEach(() => {
    sendAwsSmsTextChunks.mockReset();
    sendAwsSmsTextChunks.mockResolvedValue([
      { messageId: "msg-1", to: "+15557654321", from: "+15551234567" },
    ]);
  });

  it("issues pairing challenge for unauthorized senders", async () => {
    const { dispatchAwsSmsInboundEvent } = await import("./inbound.js");
    const upsertPairingRequest = vi.fn(async () => ({ code: "ABCD12", created: true }));
    const channelRuntime = {
      pairing: {
        readAllowFromStore: vi.fn(async () => []),
        upsertPairingRequest,
      },
      routing: {
        resolveAgentRoute: vi.fn(() => ({
          agentId: "main",
          sessionKey: "agent:main:aws-sms:direct:+15557654321",
        })),
      },
      inbound: {
        run: vi.fn(async () => undefined),
        buildContext: vi.fn(),
      },
      session: {
        resolveStorePath: vi.fn(() => "/tmp/store"),
      },
      reply: {
        dispatchReplyWithBufferedBlockDispatcher: vi.fn(),
      },
    };

    await dispatchAwsSmsInboundEvent({
      cfg: {
        channels: {
          "aws-sms": {
            enabled: true,
            region: "us-east-1",
            originationIdentity: "+15551234567",
            fromNumber: "+15551234567",
            dmPolicy: "pairing",
          },
        },
      },
      account: {
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
        dmPolicy: "pairing",
        allowFrom: [],
        textChunkLimit: 1500,
        mediaMaxMb: 0.6,
      },
      msg: {
        messageId: "inbound-1",
        from: "+15557654321",
        to: "+15551234567",
        body: "hello",
      },
      channelRuntime: channelRuntime as never,
    });

    expect(upsertPairingRequest).toHaveBeenCalledOnce();
    expect(sendAwsSmsTextChunks).toHaveBeenCalledOnce();
    expect(channelRuntime.inbound.run).not.toHaveBeenCalled();
  });
});
