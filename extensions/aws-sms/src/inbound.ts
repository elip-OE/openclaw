// Aws Sms plugin module implements inbound behavior.
import { createChannelPairingController } from "openclaw/plugin-sdk/channel-pairing";
import {
  resolveDirectDmAuthorizationOutcome,
  resolveSenderCommandAuthorizationWithRuntime,
} from "openclaw/plugin-sdk/command-auth";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-types";
import { normalizeAwsSmsAllowFrom, normalizeAwsSmsPhoneNumber } from "./phone.js";
import { getAwsSmsRuntime } from "./runtime.js";
import { sendAwsSmsTextChunks } from "./send.js";
import type { AwsSmsInboundMessage, ResolvedAwsSmsAccount } from "./types.js";

const CHANNEL_ID = "aws-sms";

type AwsSmsLog = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

function isAwsSmsSenderAllowed(senderId: string, allowFrom: string[]): boolean {
  const normalizedSender = normalizeAwsSmsPhoneNumber(senderId);
  return allowFrom.some((entry) => {
    if (entry === "*") {
      return true;
    }
    return normalizeAwsSmsAllowFrom(entry) === normalizedSender;
  });
}

export async function dispatchAwsSmsInboundEvent(params: {
  cfg: OpenClawConfig;
  account: ResolvedAwsSmsAccount;
  msg: AwsSmsInboundMessage;
  log?: AwsSmsLog;
}): Promise<void> {
  const rt = getAwsSmsRuntime();
  const from = normalizeAwsSmsPhoneNumber(params.msg.from);
  const pairing = createChannelPairingController({
    core: rt,
    channel: CHANNEL_ID,
    accountId: params.account.accountId,
  });

  const { senderAllowedForCommands } = await resolveSenderCommandAuthorizationWithRuntime({
    cfg: params.cfg,
    rawBody: params.msg.body,
    isGroup: false,
    dmPolicy: params.account.dmPolicy,
    configuredAllowFrom: params.account.allowFrom,
    senderId: from,
    isSenderAllowed: isAwsSmsSenderAllowed,
    channel: CHANNEL_ID,
    accountId: params.account.accountId,
    readAllowFromStore: pairing.readAllowFromStore,
    runtime: rt.channel.commands,
  });

  const directDmOutcome = resolveDirectDmAuthorizationOutcome({
    isGroup: false,
    dmPolicy: params.account.dmPolicy,
    senderAllowedForCommands,
  });

  if (directDmOutcome === "disabled") {
    params.log?.warn?.(`AWS SMS sender ${from} blocked (dmPolicy=disabled)`);
    return;
  }
  if (directDmOutcome === "unauthorized") {
    if (params.account.dmPolicy === "pairing") {
      await pairing.issueChallenge({
        senderId: from,
        senderIdLine: `Your AWS SMS phone number: ${from}`,
        sendPairingReply: async (text) => {
          await sendAwsSmsTextChunks({
            account: params.account,
            to: from,
            text,
          });
        },
        onCreated: () => {
          params.log?.info?.(`AWS SMS pairing request created for ${from}`);
        },
        onReplyError: (err) => {
          params.log?.warn?.(`AWS SMS pairing reply failed for ${from}: ${String(err)}`);
        },
      });
    } else {
      params.log?.warn?.(`AWS SMS sender ${from} is not authorized`);
    }
    return;
  }

  const route = rt.channel.routing.resolveAgentRoute({
    cfg: params.cfg,
    channel: CHANNEL_ID,
    accountId: params.account.accountId,
    peer: {
      kind: "direct",
      id: from,
    },
  });

  await rt.channel.turn.run({
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
      resolveTurn: (input) => {
        const ctxPayload = rt.channel.turn.buildContext({
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
            routeSessionKey: route.sessionKey,
          },
          reply: {
            to: `aws-sms:${from}`,
            originatingTo: `aws-sms:${from}`,
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
        const storePath = rt.channel.session.resolveStorePath(params.cfg.session?.store, {
          agentId: route.agentId,
        });
        return {
          cfg: params.cfg,
          channel: CHANNEL_ID,
          accountId: params.account.accountId,
          agentId: route.agentId,
          routeSessionKey: route.sessionKey,
          storePath,
          ctxPayload,
          recordInboundSession: rt.channel.session.recordInboundSession,
          dispatchReplyWithBufferedBlockDispatcher:
            rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher,
          delivery: {
            deliver: async (payload) => {
              const text = payload.text ?? payload.body;
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
