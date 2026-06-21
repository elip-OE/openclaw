// Aws Sms plugin module implements send behavior.
import { chunkTextForOutbound, stripMarkdown } from "openclaw/plugin-sdk/text-chunking";
import { createAwsSmsClients } from "./aws-client.js";
import { sendMediaViaAws, sendTextViaAws } from "./aws-sms.js";
import { stageAwsSmsMediaForSend } from "./media.js";
import type { ResolvedAwsSmsAccount, AwsSmsSendResult } from "./types.js";

export const AWS_SMS_MMS_MAX_BYTES = 600 * 1024;

export function toAwsSmsPlainText(text: string): string {
  const withoutFencedCodeMarkers = text.replace(
    /```[^\n]*\n?([\s\S]*?)```/g,
    (_match, body: string) => body.trim(),
  );
  const withReadableLinks = withoutFencedCodeMarkers.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_match, label: string, url: string) => {
      const cleanLabel = label.trim();
      const cleanUrl = url.trim();
      return cleanLabel && cleanLabel !== cleanUrl ? `${cleanLabel} (${cleanUrl})` : cleanUrl;
    },
  );
  return stripMarkdown(withReadableLinks)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendAwsSmsTextChunks(params: {
  account: ResolvedAwsSmsAccount;
  to: string;
  text: string;
}): Promise<AwsSmsSendResult[]> {
  const text = toAwsSmsPlainText(params.text);
  if (!text) {
    throw new Error("AWS SMS send requires non-empty text.");
  }
  const chunks = chunkTextForOutbound(text, params.account.textChunkLimit).filter(Boolean);
  const sendChunks = chunks.length ? chunks : [text];
  const clients = createAwsSmsClients(params.account);
  const results: AwsSmsSendResult[] = [];
  for (const textLocal of sendChunks) {
    results.push(
      await sendTextViaAws({
        account: params.account,
        client: clients.sms,
        to: params.to,
        text: textLocal,
      }),
    );
  }
  return results;
}

export async function sendAwsSmsMedia(params: {
  account: ResolvedAwsSmsAccount;
  to: string;
  text?: string;
  mediaUrl: string;
  mediaLocalRoots?: readonly string[] | "any";
  mediaReadFile?: (filePath: string) => Promise<Buffer>;
  workspaceDir?: string;
}): Promise<AwsSmsSendResult> {
  if (!params.account.mediaBucket) {
    throw new Error("AWS SMS MMS requires channels.aws-sms.mediaBucket or AWS_SMS_MEDIA_BUCKET.");
  }
  const staged = await stageAwsSmsMediaForSend({
    account: params.account,
    mediaUrl: params.mediaUrl,
    mediaLocalRoots: params.mediaLocalRoots,
    mediaReadFile: params.mediaReadFile,
    workspaceDir: params.workspaceDir,
  });
  const clients = createAwsSmsClients(params.account);
  return await sendMediaViaAws({
    account: params.account,
    client: clients.sms,
    to: params.to,
    text: params.text ? toAwsSmsPlainText(params.text) : undefined,
    mediaUrls: [staged.s3Uri],
  });
}
