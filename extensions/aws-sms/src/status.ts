// Aws Sms plugin module implements status behavior.
import {
  describeConfiguredPhoneNumber,
  probeInboundSnsSubscription,
  probeMediaBucket,
  readTwoWayTopicArn,
} from "./resources.js";
import { formatAwsSmsSetupScriptsSummary } from "./setup-scripts.js";
import type { ResolvedAwsSmsAccount } from "./types.js";

type ChannelCapabilitiesDisplayLine = {
  text: string;
  tone?: "default" | "muted" | "success" | "warn" | "error";
};

export type AwsSmsProbe = {
  ok: boolean;
  error?: string;
  inboundTopic?: Awaited<ReturnType<typeof probeInboundSnsSubscription>>;
  twoWayTopicArn?: string;
  mediaBucketOk?: boolean;
  hints: string[];
};

function inboundTopicError(
  probe: Awaited<ReturnType<typeof probeInboundSnsSubscription>>,
): string | undefined {
  switch (probe.status) {
    case "matches":
    case "skipped":
      return undefined;
    case "missing-topic":
      return "inboundSnsTopicArn is not configured.";
    case "missing-subscription":
      return `SNS topic ${probe.topicArn} has no HTTPS subscription for publicWebhookUrl.`;
    case "url-mismatch":
      return `SNS HTTPS subscription points at ${probe.subscribedUrl}; expected ${probe.configuredUrl}.`;
  }
  return undefined;
}

export async function probeAwsSmsAccount(params: {
  account: ResolvedAwsSmsAccount;
  timeoutMs: number;
}): Promise<AwsSmsProbe> {
  void params.timeoutMs;
  const hints: string[] = [];
  if (!params.account.region) {
    return {
      ok: false,
      error: "AWS SMS probe requires region or AWS_REGION.",
      hints: [formatAwsSmsSetupScriptsSummary()],
    };
  }

  const inboundTopic = await probeInboundSnsSubscription({ account: params.account });
  let twoWayTopicArn = "";
  try {
    const phoneNumber = await describeConfiguredPhoneNumber(params.account);
    twoWayTopicArn = readTwoWayTopicArn(phoneNumber);
    if (
      params.account.inboundSnsTopicArn &&
      twoWayTopicArn &&
      twoWayTopicArn !== params.account.inboundSnsTopicArn
    ) {
      hints.push(
        `Phone number two-way topic ${twoWayTopicArn} differs from configured inboundSnsTopicArn ${params.account.inboundSnsTopicArn}.`,
      );
    }
  } catch (cause) {
    hints.push(
      `DescribePhoneNumbers probe failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const mediaBucket = params.account.mediaBucket
    ? await probeMediaBucket({ account: params.account })
    : { ok: false, reason: "mediaBucket is not configured." };
  if (!mediaBucket.ok && params.account.mediaBucket) {
    hints.push(`Media bucket probe failed: ${mediaBucket.reason ?? "unknown"}`);
  }

  const error =
    inboundTopicError(inboundTopic) ??
    (mediaBucket.ok || !params.account.mediaBucket
      ? undefined
      : `Media bucket ${params.account.mediaBucket} is not reachable.`);

  if (error) {
    hints.push(formatAwsSmsSetupScriptsSummary());
    hints.push("Run extensions/aws-sms/scripts/verify-setup.sh with AWS credentials exported.");
  }

  return {
    ok: !error,
    ...(error ? { error } : {}),
    inboundTopic,
    ...(twoWayTopicArn ? { twoWayTopicArn } : {}),
    mediaBucketOk: mediaBucket.ok,
    hints,
  };
}

export function formatAwsSmsProbeLines(probe: unknown): ChannelCapabilitiesDisplayLine[] {
  if (!probe || typeof probe !== "object") {
    return [];
  }
  const awsProbe = probe as Partial<AwsSmsProbe>;
  const lines: ChannelCapabilitiesDisplayLine[] = [];
  if (awsProbe.ok === true) {
    lines.push({ text: "Probe: ok", tone: "success" });
  } else if (awsProbe.ok === false) {
    lines.push({
      text: `Probe: failed${awsProbe.error ? ` (${awsProbe.error})` : ""}`,
      tone: "error",
    });
  }
  if (awsProbe.inboundTopic?.status === "matches") {
    lines.push({ text: `SNS inbound webhook: ${awsProbe.inboundTopic.subscribedUrl}` });
  } else if (awsProbe.inboundTopic?.status && awsProbe.inboundTopic.status !== "skipped") {
    lines.push({
      text: `SNS inbound webhook: ${awsProbe.inboundTopic.status}`,
      tone: "warn",
    });
  }
  if (awsProbe.twoWayTopicArn) {
    lines.push({ text: `Two-way topic: ${awsProbe.twoWayTopicArn}`, tone: "muted" });
  }
  if (awsProbe.mediaBucketOk === true) {
    lines.push({ text: "MMS media bucket: reachable", tone: "muted" });
  } else if (awsProbe.mediaBucketOk === false) {
    lines.push({ text: "MMS media bucket: missing or unreachable", tone: "warn" });
  }
  for (const hint of awsProbe.hints ?? []) {
    lines.push({ text: hint, tone: "warn" });
  }
  return lines;
}
