// Aws Sms tests cover webhook plugin behavior.
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAwsSmsWebhookReplayCacheForTest } from "./webhook.js";

vi.mock("./sns-webhook.js", async () => {
  const actual = await vi.importActual<typeof import("./sns-webhook.js")>("./sns-webhook.js");
  return {
    ...actual,
    verifySnsEnvelopeSignature: vi.fn(async () => true),
    confirmSnsSubscription: vi.fn(async () => undefined),
  };
});

const dispatchAwsSmsInboundEvent = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("./inbound.js", () => ({
  dispatchAwsSmsInboundEvent,
}));

describe("createAwsSmsWebhookHandler", () => {
  let server: Server | undefined;

  afterEach(async () => {
    resetAwsSmsWebhookReplayCacheForTest();
    dispatchAwsSmsInboundEvent.mockClear();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => (err ? reject(err) : resolve()));
      });
      server = undefined;
    }
  });

  it("accepts valid SNS notification payloads", async () => {
    const { createAwsSmsWebhookHandler } = await import("./webhook.js");
    const handler = createAwsSmsWebhookHandler({
      cfg: { channels: { "aws-sms": { enabled: true } } },
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
      log: undefined,
    });

    server = createServer(async (req, res) => {
      await handler(req, res);
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected server address");
    }

    const body = JSON.stringify({
      Type: "Notification",
      MessageId: "sns-1",
      TopicArn: "arn:aws:sns:us-east-1:123456789012:topic",
      Timestamp: "2026-06-21T12:00:00.000Z",
      SignatureVersion: "1",
      Signature: "abc",
      SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
      Message: JSON.stringify({
        originationNumber: "+14255550182",
        destinationNumber: "+12125550101",
        messageBody: "hello",
        inboundMessageId: "inbound-1",
      }),
    });

    const response = await fetch(`http://127.0.0.1:${address.port}/webhooks/aws-sms`, {
      method: "POST",
      headers: { "content-type": "text/plain; charset=UTF-8" },
      body,
    });
    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(dispatchAwsSmsInboundEvent).toHaveBeenCalledOnce();
  });
});
