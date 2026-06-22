// Twilio SMS inbound handling — adapted for 2026.5.7 plugin API.
// Uses dispatchInboundDirectDmWithRuntime (available in 2026.5.7) instead of
// the 2026.6.2-only channelRuntime.inbound.run API.
import { resolveInboundDirectDmAccessWithRuntime } from "openclaw/plugin-sdk/direct-dm-access";
import { dispatchInboundDirectDmWithRuntime } from "openclaw/plugin-sdk/direct-dm";
import { isSenderIdAllowed } from "openclaw/plugin-sdk/allow-from";
import { createChannelPairingChallengeIssuer } from "openclaw/plugin-sdk/channel-pairing";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import type { PluginRuntime } from "openclaw/plugin-sdk/plugin-runtime";
import { normalizeSmsPhoneNumber } from "./phone.js";
import { sendSmsTextChunks } from "./send.js";
import type { ResolvedSmsAccount, SmsInboundMessage } from "./types.js";

const CHANNEL_ID = "sms";

type SmsLog = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export type SmsChannelRuntime = Pick<
  PluginRuntime["channel"],
  "pairing" | "reply" | "routing" | "session"
>;

async function authorizeSmsSender(params: {
  cfg: OpenClawConfig;
  account: ResolvedSmsAccount;
  channelRuntime: SmsChannelRuntime;
  from: string;
}) {
  // For allowlist policy, the 2026.5.7 SDK ignores the credential store.
  // Merge store entries into allowFrom ourselves so pre-approved driver numbers
  // are recognized without needing them in the config file.
  let effectiveAllowFrom = params.account.allowFrom;
  if (params.account.dmPolicy === "allowlist") {
    try {
      const storeEntries = await params.channelRuntime.pairing.readAllowFromStore({
        channel: CHANNEL_ID,
        accountId: params.account.accountId,
      });
      if (storeEntries?.length) {
        effectiveAllowFrom = [...effectiveAllowFrom, ...storeEntries];
      }
    } catch { /* store read failed, continue with config-only allowFrom */ }
  }

  const result = await resolveInboundDirectDmAccessWithRuntime({
    cfg: params.cfg,
    channel: CHANNEL_ID,
    accountId: params.account.accountId,
    dmPolicy: params.account.dmPolicy,
    allowFrom: effectiveAllowFrom,
    senderId: params.from,
    rawBody: "",
    isSenderAllowed: (senderId: string, allowFrom: string[]) => {
      const allow = {
        hasEntries: allowFrom.length > 0,
        hasWildcard: allowFrom.includes("*"),
        entries: allowFrom,
      };
      return isSenderIdAllowed(allow, senderId);
    },
    runtime: {
      shouldComputeCommandAuthorized: () => false,
      resolveCommandAuthorizedFromAuthorizers: () => true,
    },
    readStoreAllowFrom: async (provider: string, accountId: string) =>
      await params.channelRuntime.pairing.readAllowFromStore({
        channel: provider,
        accountId,
      }),
  });
  return {
    senderAccess: {
      allowed: result.access.decision === "allow",
      decision: result.access.decision,
    },
  };
}

async function issueSmsPairingChallenge(params: {
  account: ResolvedSmsAccount;
  channelRuntime: SmsChannelRuntime;
  from: string;
  log?: SmsLog;
}) {
  const issueChallenge = createChannelPairingChallengeIssuer({
    channel: CHANNEL_ID,
    upsertPairingRequest: async (input) =>
      await params.channelRuntime.pairing.upsertPairingRequest({
        channel: CHANNEL_ID,
        accountId: params.account.accountId,
        ...input,
      }),
  });
  await issueChallenge({
    senderId: params.from,
    senderIdLine: `Your SMS phone number: ${params.from}`,
    sendPairingReply: async (text) => {
      await sendSmsTextChunks({ account: params.account, to: params.from, text });
    },
    onCreated: () => { params.log?.info?.(`SMS pairing request created for ${params.from}`); },
    onReplyError: (err) => { params.log?.warn?.(`SMS pairing reply failed for ${params.from}: ${String(err)}`); },
  });
}

export async function dispatchSmsInboundEvent(params: {
  cfg: OpenClawConfig;
  account: ResolvedSmsAccount;
  msg: SmsInboundMessage;
  channelRuntime: SmsChannelRuntime;
  log?: SmsLog;
}): Promise<void> {
  const from = normalizeSmsPhoneNumber(params.msg.from);
  const auth = await authorizeSmsSender({
    cfg: params.cfg, account: params.account, channelRuntime: params.channelRuntime, from,
  });
  if (!auth.senderAccess.allowed) {
    if (auth.senderAccess.decision === "pairing") {
      await issueSmsPairingChallenge({ account: params.account, channelRuntime: params.channelRuntime, from, log: params.log });
      return;
    }
    params.log?.warn?.(`SMS sender ${from} is not authorized`);
    return;
  }

  await dispatchInboundDirectDmWithRuntime({
    cfg: params.cfg,
    runtime: { channel: params.channelRuntime },
    channel: CHANNEL_ID,
    channelLabel: "SMS",
    accountId: params.account.accountId,
    peer: { kind: "direct", id: from },
    senderId: from,
    senderAddress: `sms:${from}`,
    recipientAddress: `sms:${from}`,  // reply target = the sender (driver)
    conversationLabel: from,
    rawBody: params.msg.body,
    messageId: params.msg.messageSid,
    timestamp: Date.now(),
    provider: "twilio",
    surface: "sms",
    extraContext: {
      MessageSid: params.msg.messageSid,
      To: params.msg.to,
    },
    deliver: async (payload) => {
      const text = payload.text;
      if (text) {
        await sendSmsTextChunks({ account: params.account, to: from, text });
      }
    },
    onRecordError: (err) => {
      params.log?.warn?.(`SMS session record error for ${from}: ${String(err)}`);
    },
    onDispatchError: (err, info) => {
      params.log?.warn?.(`SMS dispatch error (${info.kind}) for ${from}: ${String(err)}`);
    },
  });
}
