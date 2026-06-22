// Aws Sms plugin module implements inbound behavior.
import { resolveInboundDirectDmAccessWithRuntime } from "openclaw/plugin-sdk/direct-dm-access";
import { isSenderIdAllowed } from "openclaw/plugin-sdk/allow-from";
import { createChannelPairingChallengeIssuer } from "openclaw/plugin-sdk/channel-pairing";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import type { PluginRuntime } from "openclaw/plugin-sdk/plugin-runtime";
import { normalizeAwsSmsPhoneNumber } from "./phone.js";
import { sendAwsSmsTextChunks } from "./send.js";
import type { AwsSmsInboundMessage, ResolvedAwsSmsAccount } from "./types.js";

const CHANNEL_ID = "aws-sms";

type AwsSmsLog = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export type AwsSmsChannelRuntime = Pick<
  PluginRuntime["channel"],
  "inbound" | "pairing" | "reply" | "routing" | "session"
>;

async function authorizeAwsSmsSender(params: {
  cfg: OpenClawConfig;
  account: ResolvedAwsSmsAccount;
  channelRuntime: AwsSmsChannelRuntime;
  from: string;
}) {
  const result = await resolveInboundDirectDmAccessWithRuntime({
    cfg: params.cfg,
    channel: CHANNEL_ID,
    accountId: params.account.accountId,
    dmPolicy: params.account.dmPolicy,
    allowFrom: params.account.allowFrom,
    senderId: params.from,
    rawBody: "",
    isSenderAllowed: (senderId: string, allowFrom: string[]) =>
      isSenderIdAllowed(senderId, allowFrom),
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

async function issueAwsSmsPairingChallenge(params: {
  account: ResolvedAwsSmsAccount;
  channelRuntime: AwsSmsChannelRuntime;
  from: string;
  log?: AwsSmsLog;
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
    senderIdLine: `Your AWS SMS phone number: ${params.from}`,
    sendPairingReply: async (text) => {
      await sendAwsSmsTextChunks({
        account: params.account,
        to: params.from,
        text,
      });
    },
    onCreated: () => {
      params.log?.info?.(`AWS SMS pairing request created for ${params.from}`);
    },
    onReplyError: (err) => {
      params.log?.warn?.(`AWS SMS pairing reply failed for ${params.from}: ${String(err)}`);
    },
  });
}

export async function dispatchAwsSmsInboundEvent(params: {
  cfg: OpenClawConfig;
  account: ResolvedAwsSmsAccount;
  msg: AwsSmsInboundMessage;
  channelRuntime: AwsSmsChannelRuntime;
  log?: AwsSmsLog;
}): Promise<void> {
  const from = normalizeAwsSmsPhoneNumber(params.msg.from);
  const auth = await authorizeAwsSmsSender({
    cfg: params.cfg,
    account: params.account,
    channelRuntime: params.channelRuntime,
    from,
  });
  if (!auth.senderAccess.allowed) {
    if (auth.senderAccess.decision === "pairing") {
      await issueAwsSmsPairingChallenge({
        account: params.account,
        channelRuntime: params.channelRuntime,
        from,
        log: params.log,
      });
      return;
    }
    params.log?.warn?.(`AWS SMS sender ${from} is not authorized`);
    return;
  }

  const route = params.channelRuntime.routing.resolveAgentRoute({
    cfg: params.cfg,
    channel: CHANNEL_ID,
    accountId: params.account.accountId,
    peer: {
      kind: "direct",
      id: from,
    },
  });
  const sessionKey = route.sessionKey;

  await params.channelRuntime.inbound.run({
    channel: CHANNEL_ID,
    accountId: params.account.accountId,
    raw: params.msg,
    adapter: {
      ingest: (msg) => ({
        id: msg.messageId,
        timestamp: Date.now(),
        rawText: msg.body,
        textForAgent: msg.body,
        textForCommands: msg.body,
        raw: msg,
      }),
      resolveTurn: async (input) => {
        const ctxPayload = params.channelRuntime.inbound.buildContext({
          channel: CHANNEL_ID,
          accountId: params.account.accountId,
          timestamp: input.timestamp,
          from: `aws-sms:${from}`,
          sender: {
            id: from,
            name: from,
          },
          conversation: {
            kind: "direct",
            id: from,
            label: from,
          },
          route: {
            agentId: route.agentId,
            accountId: params.account.accountId,
            routeSessionKey: sessionKey,
            dispatchSessionKey: sessionKey,
          },
          reply: {
            to: `aws-sms:${from}`,
          },
          message: {
            rawBody: input.rawText,
            commandBody: input.textForCommands,
            bodyForAgent: input.textForAgent,
          },
          extra: {
            InboundMessageId: params.msg.messageId,
            To: params.msg.to,
            ...(params.msg.previousPublishedMessageId
              ? { PreviousPublishedMessageId: params.msg.previousPublishedMessageId }
              : {}),
          },
        });
        const storePath = params.channelRuntime.session.resolveStorePath(
          params.cfg.session?.store,
          {
            agentId: route.agentId,
          },
        );
        return {
          cfg: params.cfg,
          channel: CHANNEL_ID,
          accountId: params.account.accountId,
          agentId: route.agentId,
          routeSessionKey: sessionKey,
          storePath,
          ctxPayload,
          recordInboundSession: params.channelRuntime.session.recordInboundSession,
          dispatchReplyWithBufferedBlockDispatcher:
            params.channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher,
          delivery: {
            durable: () => ({
              to: from,
            }),
            deliver: async (payload) => {
              const text = payload.text;
              if (!text) {
                return { visibleReplySent: false };
              }
              await sendAwsSmsTextChunks({
                account: params.account,
                to: from,
                text,
              });
              return { visibleReplySent: true };
            },
          },
          dispatcherOptions: {
            onReplyStart: () => {
              params.log?.info?.(`AWS SMS reply started for ${from}`);
            },
          },
        };
      },
    },
  });
}
