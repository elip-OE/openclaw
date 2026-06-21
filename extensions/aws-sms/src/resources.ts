// Aws Sms plugin module implements AWS resource probes.
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { ListSubscriptionsByTopicCommand } from "@aws-sdk/client-sns";
import { createAwsSmsClients } from "./aws-client.js";
import { describePhoneNumbers, describePools } from "./aws-sms.js";
import type { ResolvedAwsSmsAccount } from "./types.js";

export type AwsSmsInboundSubscriptionProbe =
  | { status: "skipped"; reason: string }
  | { status: "missing-topic" }
  | { status: "missing-subscription"; topicArn: string }
  | { status: "url-mismatch"; topicArn: string; configuredUrl: string; subscribedUrl: string }
  | { status: "matches"; topicArn: string; subscribedUrl: string };

export async function probeInboundSnsSubscription(params: {
  account: ResolvedAwsSmsAccount;
}): Promise<AwsSmsInboundSubscriptionProbe> {
  if (!params.account.inboundSnsTopicArn) {
    return { status: "missing-topic" };
  }
  if (!params.account.publicWebhookUrl) {
    return {
      status: "skipped",
      reason: "publicWebhookUrl is required to compare SNS HTTPS subscriptions.",
    };
  }
  const clients = createAwsSmsClients(params.account);
  const response = await clients.sns.send(
    new ListSubscriptionsByTopicCommand({
      TopicArn: params.account.inboundSnsTopicArn,
    }),
  );
  const expected = params.account.publicWebhookUrl.trim();
  const httpsMatch = (response.Subscriptions ?? []).find(
    (entry) => entry.Protocol === "https" && entry.Endpoint?.trim() === expected,
  );
  if (!httpsMatch) {
    const firstHttps = (response.Subscriptions ?? []).find((entry) => entry.Protocol === "https");
    if (!firstHttps?.Endpoint) {
      return {
        status: "missing-subscription",
        topicArn: params.account.inboundSnsTopicArn,
      };
    }
    return {
      status: "url-mismatch",
      topicArn: params.account.inboundSnsTopicArn,
      configuredUrl: expected,
      subscribedUrl: firstHttps.Endpoint,
    };
  }
  return {
    status: "matches",
    topicArn: params.account.inboundSnsTopicArn,
    subscribedUrl: httpsMatch.Endpoint ?? expected,
  };
}

export async function probeMediaBucket(params: {
  account: ResolvedAwsSmsAccount;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!params.account.mediaBucket) {
    return { ok: false, reason: "mediaBucket is not configured." };
  }
  try {
    const clients = createAwsSmsClients(params.account);
    await clients.s3.send(new HeadBucketCommand({ Bucket: params.account.mediaBucket }));
    return { ok: true };
  } catch (cause) {
    return {
      ok: false,
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export async function describeConfiguredPhoneNumber(account: ResolvedAwsSmsAccount) {
  const clients = createAwsSmsClients(account);
  const phoneNumbers = await describePhoneNumbers({
    client: clients.sms,
    phoneNumber: account.fromNumber || account.originationIdentity,
  });
  return phoneNumbers[0];
}

export async function describeConfiguredPool(account: ResolvedAwsSmsAccount, poolId: string) {
  const clients = createAwsSmsClients(account);
  const pools = await describePools({
    client: clients.sms,
    poolId,
  });
  return pools[0];
}

export function readTwoWayTopicArn(
  phoneNumber: { TwoWayChannelArn?: string | undefined } | undefined,
): string {
  return phoneNumber?.TwoWayChannelArn?.trim() ?? "";
}
