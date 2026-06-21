// Aws Sms tests cover inbound plugin behavior.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { sendAwsSmsTextChunks as sendAwsSmsTextChunksType } from "./send.js";

const sendAwsSmsTextChunks = vi.fn<typeof sendAwsSmsTextChunksType>();
const turnRun = vi.fn(async () => undefined);
const issueChallenge = vi.fn(async () => undefined);
const readAllowFromStore = vi.fn(async () => [] as string[]);
const upsertPairingRequest = vi.fn(async () => ({ code: "ABCD12", created: true }));

vi.mock("./send.js", () => ({
  sendAwsSmsTextChunks,
  toAwsSmsPlainText: (text: string) => text,
}));

vi.mock("./runtime.js", () => ({
  getAwsSmsRuntime: () => ({
    channel: {
      commands: {
        shouldComputeCommandAuthorized: () => false,
        resolveCommandAuthorizedFromAuthorizers: () => false,
      },
      pairing: {
        readAllowFromStore,
        upsertPairingRequest,
      },
      routing: {
        resolveAgentRoute: vi.fn(() => ({
          agentId: "main",
          sessionKey: "agent:main:aws-sms:direct:+15557654321",
        })),
      },
      turn: {
        run: turnRun,
        buildContext: vi.fn((params: unknown) => params),
      },
      session: {
        resolveStorePath: vi.fn(() => "/tmp/store"),
        recordInboundSession: vi.fn(),
      },
      reply: {
        dispatchReplyWithBufferedBlockDispatcher: vi.fn(),
      },
    },
  }),
}));

vi.mock("openclaw/plugin-sdk/channel-pairing", () => ({
  createChannelPairingController: () => ({
    readAllowFromStore,
    upsertPairingRequest,
    issueChallenge,
  }),
}));

describe("dispatchAwsSmsInboundEvent", () => {
  beforeEach(() => {
    sendAwsSmsTextChunks.mockReset();
    turnRun.mockClear();
    issueChallenge.mockClear();
    readAllowFromStore.mockReset();
    readAllowFromStore.mockResolvedValue([]);
    upsertPairingRequest.mockReset();
    upsertPairingRequest.mockResolvedValue({ code: "ABCD12", created: true });
    sendAwsSmsTextChunks.mockResolvedValue([
      { messageId: "msg-1", to: "+15557654321", from: "+15551234567" },
    ]);
  });

  it("issues pairing challenge for unauthorized senders", async () => {
    const { dispatchAwsSmsInboundEvent } = await import("./inbound.js");

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
    });

    expect(issueChallenge).toHaveBeenCalledOnce();
    expect(sendAwsSmsTextChunks).toHaveBeenCalledOnce();
    expect(turnRun).not.toHaveBeenCalled();
  });
});
