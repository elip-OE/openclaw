// Aws Sms plugin module implements doctor and startup validation hints.
import { formatAwsSmsSetupScriptsSummary } from "./setup-scripts.js";
import { probeAwsSmsAccount, type AwsSmsProbe } from "./status.js";
import type { ResolvedAwsSmsAccount } from "./types.js";

export function collectAwsSmsStartupWarnings(account: ResolvedAwsSmsAccount): string[] {
  const warnings: string[] = [];
  if (!account.region || !account.originationIdentity || !account.fromNumber) {
    warnings.push(
      "- AWS SMS: region, originationIdentity, and fromNumber are required. Set AWS_REGION and AWS_SMS_* env vars or channels.aws-sms config.",
    );
  }
  if (!account.inboundSnsTopicArn) {
    warnings.push(
      "- AWS SMS: inboundSnsTopicArn is required for inbound SMS. Run scripts/create-inbound-topic.sh and scripts/enable-two-way-sms.sh.",
    );
  }
  if (!account.publicWebhookUrl) {
    warnings.push(
      "- AWS SMS: publicWebhookUrl is required so SNS HTTPS subscriptions can reach the gateway.",
    );
  }
  if (!account.mediaBucket) {
    warnings.push(
      "- AWS SMS: mediaBucket is not configured. Outbound MMS will fail until scripts/create-mms-media-bucket.sh is applied.",
    );
  }
  if (account.dmPolicy === "allowlist" && account.allowFrom.length === 0) {
    warnings.push("- AWS SMS: dmPolicy=allowlist with empty allowFrom rejects every sender.");
  }
  if (account.dmPolicy === "open" && !account.allowFrom.includes("*")) {
    warnings.push(
      '- AWS SMS: dmPolicy=open should set allowFrom=["*"] or explicit sender numbers.',
    );
  }
  return warnings;
}

export function collectAwsSmsDoctorHints(account: ResolvedAwsSmsAccount): string[] {
  const hints = collectAwsSmsStartupWarnings(account).filter((line) => line.includes("required"));
  if (hints.length > 0) {
    hints.push(`Setup scripts:\n${formatAwsSmsSetupScriptsSummary()}`);
    hints.push("Run extensions/aws-sms/scripts/verify-setup.sh after exporting AWS credentials.");
  }
  return hints;
}

export async function runAwsSmsDoctorChecks(params: {
  account: ResolvedAwsSmsAccount;
  timeoutMs?: number;
}): Promise<AwsSmsProbe> {
  const staticHints = collectAwsSmsDoctorHints(params.account);
  const probe = await probeAwsSmsAccount({
    account: params.account,
    timeoutMs: params.timeoutMs ?? 15_000,
  });
  if (staticHints.length > 0) {
    return {
      ...probe,
      ok: false,
      hints: [...staticHints, ...probe.hints],
    };
  }
  return probe;
}
