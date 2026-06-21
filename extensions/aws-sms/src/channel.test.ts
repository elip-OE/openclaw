// Aws Sms tests cover channel plugin behavior.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ChannelModule = typeof import("./channel.js");

let resolveAwsSmsTextChunkLimit: ChannelModule["resolveAwsSmsTextChunkLimit"];
let awsSmsPlugin: ChannelModule["awsSmsPlugin"];

const sendTextViaAws = vi.hoisted(() =>
  vi.fn(async ({ to }: { to: string }) => ({
    messageId: "msg-default",
    to,
    from: "+15551234567",
  })),
);

const sendMediaViaAws = vi.hoisted(() =>
  vi.fn(async ({ to }: { to: string }) => ({
    messageId: "msg-media-default",
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

beforeEach(async () => {
  vi.resetModules();
  sendTextViaAws.mockClear();
  sendMediaViaAws.mockClear();
  stageAwsSmsMediaForSend.mockClear();
  vi.doMock("./aws-sms.js", () => ({
    sendTextViaAws,
    sendMediaViaAws,
    describePhoneNumbers: vi.fn(async () => []),
    describePools: vi.fn(async () => []),
  }));
  vi.doMock("./media.js", () => ({
    stageAwsSmsMediaForSend,
  }));
  vi.doMock("./resources.js", () => ({
    probeInboundSnsSubscription: vi.fn(async () => ({
      status: "matches",
      topicArn: "arn",
      subscribedUrl: "https://gateway.example.com/webhooks/aws-sms",
    })),
    probeMediaBucket: vi.fn(async () => ({ ok: true })),
    describeConfiguredPhoneNumber: vi.fn(async () => ({
      TwoWayChannelArn: "arn:aws:sns:us-east-1:123456789012:topic",
    })),
    describeConfiguredPool: vi.fn(async () => undefined),
    readTwoWayTopicArn: (phoneNumber: { TwoWayChannelArn?: string }) =>
      phoneNumber.TwoWayChannelArn ?? "",
  }));
  ({ resolveAwsSmsTextChunkLimit, awsSmsPlugin } = await import("./channel.js"));
});

afterEach(() => {
  vi.doUnmock("./aws-sms.js");
  vi.doUnmock("./media.js");
  vi.doUnmock("./resources.js");
});

describe("awsSmsPlugin", () => {
  it("builds a status snapshot for configured accounts", async () => {
    const snapshot = await awsSmsPlugin.status?.buildAccountSnapshot?.({
      cfg: {},
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
    });

    expect(snapshot).toEqual({
      accountId: "default",
      name: "+15551234567",
      enabled: true,
      configured: true,
      statusState: "configured",
    });
  });

  it("declares aws-sms targets, media support, and agent tools", () => {
    expect(awsSmsPlugin.messaging?.targetPrefixes).toEqual(["aws-sms"]);
    expect(awsSmsPlugin.capabilities?.media).toBe(true);
    expect(awsSmsPlugin.agentTools?.({ cfg: {} }).map((tool) => tool.name)).toEqual(["aws_sms"]);
    expect(
      resolveAwsSmsTextChunkLimit({
        cfg: {
          channels: {
            "aws-sms": {
              region: "us-east-1",
              originationIdentity: "+15551234567",
              fromNumber: "+15551234567",
              textChunkLimit: 42,
            },
          },
        },
      }),
    ).toBe(42);
  });
});
