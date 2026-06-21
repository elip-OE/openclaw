// Aws Sms plugin module implements AWS End User Messaging SMS API calls.
import {
  DescribePhoneNumbersCommand,
  DescribePoolsCommand,
  SendMediaMessageCommand,
  SendTextMessageCommand,
  type PinpointSMSVoiceV2Client,
} from "@aws-sdk/client-pinpoint-sms-voice-v2";
import type { ResolvedAwsSmsAccount, AwsSmsSendResult } from "./types.js";

export class AwsSmsApiError extends Error {
  readonly operation: string;

  constructor(operation: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`AWS SMS ${operation} failed: ${detail}`);
    this.name = "AwsSmsApiError";
    this.operation = operation;
  }
}

export async function sendTextViaAws(params: {
  account: ResolvedAwsSmsAccount;
  client: PinpointSMSVoiceV2Client;
  to: string;
  text: string;
}): Promise<AwsSmsSendResult> {
  try {
    const response = await params.client.send(
      new SendTextMessageCommand({
        DestinationPhoneNumber: params.to,
        OriginationIdentity: params.account.originationIdentity,
        MessageBody: params.text,
        MessageType: "TRANSACTIONAL",
      }),
    );
    const messageId = response.MessageId?.trim();
    if (!messageId) {
      throw new Error("SendTextMessage response did not include MessageId.");
    }
    return {
      messageId,
      to: params.to,
      from: params.account.fromNumber || undefined,
    };
  } catch (cause) {
    throw new AwsSmsApiError("SendTextMessage", cause);
  }
}

export async function sendMediaViaAws(params: {
  account: ResolvedAwsSmsAccount;
  client: PinpointSMSVoiceV2Client;
  to: string;
  text?: string;
  mediaUrls: string[];
}): Promise<AwsSmsSendResult> {
  if (!params.mediaUrls.length) {
    throw new Error("AWS SMS media send requires at least one media URL.");
  }
  try {
    const response = await params.client.send(
      new SendMediaMessageCommand({
        DestinationPhoneNumber: params.to,
        OriginationIdentity: params.account.originationIdentity,
        ...(params.text?.trim() ? { MessageBody: params.text.trim() } : {}),
        MediaUrls: params.mediaUrls,
      }),
    );
    const messageId = response.MessageId?.trim();
    if (!messageId) {
      throw new Error("SendMediaMessage response did not include MessageId.");
    }
    return {
      messageId,
      to: params.to,
      from: params.account.fromNumber || undefined,
    };
  } catch (cause) {
    throw new AwsSmsApiError("SendMediaMessage", cause);
  }
}

export async function describePhoneNumbers(params: {
  client: PinpointSMSVoiceV2Client;
  phoneNumber?: string;
}) {
  try {
    const response = await params.client.send(
      new DescribePhoneNumbersCommand({
        ...(params.phoneNumber ? { PhoneNumbers: [params.phoneNumber] } : {}),
      }),
    );
    return response.PhoneNumbers ?? [];
  } catch (cause) {
    throw new AwsSmsApiError("DescribePhoneNumbers", cause);
  }
}

export async function describePools(params: { client: PinpointSMSVoiceV2Client; poolId?: string }) {
  try {
    const response = await params.client.send(
      new DescribePoolsCommand({
        ...(params.poolId ? { PoolIds: [params.poolId] } : {}),
      }),
    );
    return response.Pools ?? [];
  } catch (cause) {
    throw new AwsSmsApiError("DescribePools", cause);
  }
}
