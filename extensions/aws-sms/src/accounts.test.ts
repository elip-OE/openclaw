// Aws Sms tests cover accounts plugin behavior.
import { describe, expect, it } from "vitest";
import { resolveAwsSmsAccount } from "./accounts.js";

describe("resolveAwsSmsAccount", () => {
  it("resolves env fallbacks for the default account", () => {
    const previous = {
      AWS_REGION: process.env.AWS_REGION,
      AWS_SMS_ORIGINATION_IDENTITY: process.env.AWS_SMS_ORIGINATION_IDENTITY,
      AWS_SMS_FROM_NUMBER: process.env.AWS_SMS_FROM_NUMBER,
      AWS_SMS_INBOUND_TOPIC_ARN: process.env.AWS_SMS_INBOUND_TOPIC_ARN,
      AWS_SMS_MEDIA_BUCKET: process.env.AWS_SMS_MEDIA_BUCKET,
    };
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_SMS_ORIGINATION_IDENTITY = "+15551234567";
    process.env.AWS_SMS_FROM_NUMBER = "+15551234567";
    process.env.AWS_SMS_INBOUND_TOPIC_ARN =
      "arn:aws:sns:us-east-1:123456789012:openclaw-aws-sms-inbound";
    process.env.AWS_SMS_MEDIA_BUCKET = "openclaw-aws-sms-media";

    try {
      const account = resolveAwsSmsAccount({
        channels: {
          "aws-sms": {
            enabled: true,
          },
        },
      });
      expect(account.region).toBe("us-east-1");
      expect(account.originationIdentity).toBe("+15551234567");
      expect(account.fromNumber).toBe("+15551234567");
      expect(account.inboundSnsTopicArn).toContain("openclaw-aws-sms-inbound");
      expect(account.mediaBucket).toBe("openclaw-aws-sms-media");
      expect(account.webhookPath).toBe("/webhooks/aws-sms");
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
