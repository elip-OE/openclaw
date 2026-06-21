import path from "node:path";
// Aws Sms plugin module implements setup script metadata.
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type AwsSmsSetupScript = {
  name: string;
  relativePath: string;
  absolutePath: string;
  purpose: string;
};

export const AWS_SMS_SETUP_SCRIPTS: AwsSmsSetupScript[] = [
  {
    name: "create-inbound-topic.sh",
    relativePath: "scripts/create-inbound-topic.sh",
    absolutePath: path.join(PLUGIN_ROOT, "scripts/create-inbound-topic.sh"),
    purpose: "Create the inbound SNS topic and print its ARN.",
  },
  {
    name: "subscribe-gateway-webhook.sh",
    relativePath: "scripts/subscribe-gateway-webhook.sh",
    absolutePath: path.join(PLUGIN_ROOT, "scripts/subscribe-gateway-webhook.sh"),
    purpose: "Subscribe the gateway HTTPS webhook URL to the inbound SNS topic.",
  },
  {
    name: "enable-two-way-sms.sh",
    relativePath: "scripts/enable-two-way-sms.sh",
    absolutePath: path.join(PLUGIN_ROOT, "scripts/enable-two-way-sms.sh"),
    purpose: "Enable two-way SMS on the origination phone number.",
  },
  {
    name: "create-mms-media-bucket.sh",
    relativePath: "scripts/create-mms-media-bucket.sh",
    absolutePath: path.join(PLUGIN_ROOT, "scripts/create-mms-media-bucket.sh"),
    purpose: "Create the regional S3 bucket used for outbound MMS staging.",
  },
  {
    name: "verify-setup.sh",
    relativePath: "scripts/verify-setup.sh",
    absolutePath: path.join(PLUGIN_ROOT, "scripts/verify-setup.sh"),
    purpose: "Run read-only checks for credentials, two-way SMS, SNS, and MMS bucket setup.",
  },
  {
    name: "iam-policy-minimal.json",
    relativePath: "scripts/iam-policy-minimal.json",
    absolutePath: path.join(PLUGIN_ROOT, "scripts/iam-policy-minimal.json"),
    purpose: "Minimal IAM policy template for gateway AWS credentials.",
  },
];

export function formatAwsSmsSetupScriptsSummary(): string {
  return AWS_SMS_SETUP_SCRIPTS.map((script) => `- ${script.relativePath}: ${script.purpose}`).join(
    "\n",
  );
}

export function resolveAwsSmsRequirementsDocPath(): string {
  return path.join(PLUGIN_ROOT, "REQUIREMENTS.md");
}
