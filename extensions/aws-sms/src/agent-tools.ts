import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
// Aws Sms plugin module implements agent tools.
import { jsonResult } from "openclaw/plugin-sdk/channel-actions";
import type { ChannelAgentTool } from "openclaw/plugin-sdk/channel-contract";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { Type } from "typebox";
import { resolveAwsSmsAccount } from "./accounts.js";
import { describeConfiguredPhoneNumber, describeConfiguredPool } from "./resources.js";
import {
  AWS_SMS_SETUP_SCRIPTS,
  formatAwsSmsSetupScriptsSummary,
  resolveAwsSmsRequirementsDocPath,
} from "./setup-scripts.js";
import { probeAwsSmsAccount } from "./status.js";

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveAccountId(raw: unknown): string {
  return readOptionalString(raw) ?? DEFAULT_ACCOUNT_ID;
}

export function createAwsSmsTool(cfg: OpenClawConfig = {}): ChannelAgentTool {
  return {
    label: "AWS SMS",
    name: "aws_sms",
    description:
      "Inspect AWS End User Messaging SMS resources and setup scripts. Supports list_numbers, describe_number, describe_pool, probe_inbound, and print_setup_scripts.",
    parameters: Type.Object({
      action: Type.Unsafe<
        | "list_numbers"
        | "describe_number"
        | "describe_pool"
        | "probe_inbound"
        | "print_setup_scripts"
      >({
        type: "string",
        enum: [
          "list_numbers",
          "describe_number",
          "describe_pool",
          "probe_inbound",
          "print_setup_scripts",
        ],
      }),
      accountId: Type.Optional(Type.String()),
      poolId: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, args) => {
      const record = args as Record<string, unknown>;
      const action = String(record.action ?? "");
      const accountId = resolveAccountId(record.accountId);

      if (action === "print_setup_scripts") {
        return jsonResult({
          requirementsDoc: resolveAwsSmsRequirementsDocPath(),
          scripts: AWS_SMS_SETUP_SCRIPTS.map(({ name, relativePath, purpose }) => ({
            name,
            relativePath,
            purpose,
          })),
          summary: formatAwsSmsSetupScriptsSummary(),
        });
      }

      const account = resolveAwsSmsAccount(cfg, accountId);

      if (action === "probe_inbound") {
        const probe = await probeAwsSmsAccount({ account, timeoutMs: 15_000 });
        return jsonResult(probe);
      }

      if (action === "describe_number") {
        const phoneNumber = await describeConfiguredPhoneNumber(account);
        return jsonResult({ accountId, phoneNumber: phoneNumber ?? null });
      }

      if (action === "describe_pool") {
        const poolId = readOptionalString(record.poolId) ?? account.originationIdentity;
        const pool = await describeConfiguredPool(account, poolId);
        return jsonResult({ accountId, poolId, pool: pool ?? null });
      }

      if (action === "list_numbers") {
        const phoneNumber = await describeConfiguredPhoneNumber(account);
        return jsonResult({
          accountId,
          phoneNumbers: phoneNumber ? [phoneNumber] : [],
        });
      }

      throw new Error(`Unsupported aws_sms action: ${action}`);
    },
  };
}
