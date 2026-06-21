// Aws Sms plugin module implements MMS media staging behavior.
import { randomBytes } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { loadOutboundMediaFromUrl } from "openclaw/plugin-sdk/outbound-media";
import { createAwsSmsClients } from "./aws-client.js";
import { AWS_SMS_MMS_MAX_BYTES } from "./send.js";
import type { ResolvedAwsSmsAccount } from "./types.js";

const MMS_CONTENT_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "audio/amr",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "video/3gpp",
  "video/mp4",
]);

function resolveMediaMaxBytes(account: ResolvedAwsSmsAccount): number {
  const configured = Math.floor(account.mediaMaxMb * 1024 * 1024);
  return Math.min(configured > 0 ? configured : AWS_SMS_MMS_MAX_BYTES, AWS_SMS_MMS_MAX_BYTES);
}

function extensionForContentType(contentType: string | undefined): string {
  switch ((contentType ?? "").split(";")[0]?.trim().toLowerCase()) {
    case "image/gif":
      return "gif";
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "audio/amr":
      return "amr";
    case "audio/mp4":
      return "m4a";
    case "audio/mpeg":
      return "mp3";
    case "audio/ogg":
      return "ogg";
    case "video/3gpp":
      return "3gp";
    case "video/mp4":
      return "mp4";
    default:
      return "bin";
  }
}

function assertSupportedMmsContentType(contentType: string | undefined): string {
  const normalized = (contentType ?? "").split(";")[0]?.trim().toLowerCase();
  if (!normalized || !MMS_CONTENT_TYPES.has(normalized)) {
    throw new Error(
      `AWS SMS MMS does not support content type ${contentType ?? "unknown"}. Supported types: ${[...MMS_CONTENT_TYPES].join(", ")}.`,
    );
  }
  return normalized;
}

export async function stageAwsSmsMediaForSend(params: {
  account: ResolvedAwsSmsAccount;
  mediaUrl: string;
  mediaLocalRoots?: readonly string[] | "any";
  mediaReadFile?: (filePath: string) => Promise<Buffer>;
  workspaceDir?: string;
}): Promise<{ s3Uri: string; contentType: string }> {
  if (!params.account.mediaBucket) {
    throw new Error("AWS SMS MMS requires channels.aws-sms.mediaBucket or AWS_SMS_MEDIA_BUCKET.");
  }
  const maxBytes = resolveMediaMaxBytes(params.account);
  const media = await loadOutboundMediaFromUrl(params.mediaUrl, {
    maxBytes,
    mediaLocalRoots: params.mediaLocalRoots,
    mediaReadFile: params.mediaReadFile,
    workspaceDir: params.workspaceDir,
  });
  if (media.buffer.byteLength > maxBytes) {
    throw new Error(
      `AWS SMS MMS media exceeds ${maxBytes} bytes (AWS limit is ${AWS_SMS_MMS_MAX_BYTES} bytes).`,
    );
  }
  const contentType = assertSupportedMmsContentType(media.contentType);
  const key = `openclaw/outbound/${Date.now()}-${randomBytes(8).toString("hex")}.${extensionForContentType(contentType)}`;
  const clients = createAwsSmsClients(params.account);
  await clients.s3.send(
    new PutObjectCommand({
      Bucket: params.account.mediaBucket,
      Key: key,
      Body: media.buffer,
      ContentType: contentType,
    }),
  );
  return {
    s3Uri: `s3://${params.account.mediaBucket}/${key.replace(/\\/g, "/")}`,
    contentType,
  };
}
