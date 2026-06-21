// Aws Sms plugin module implements AWS SDK client factories.
import { PinpointSMSVoiceV2Client } from "@aws-sdk/client-pinpoint-sms-voice-v2";
import { S3Client } from "@aws-sdk/client-s3";
import { SNSClient } from "@aws-sdk/client-sns";
import type { ResolvedAwsSmsAccount } from "./types.js";

export type AwsSmsClients = {
  sms: PinpointSMSVoiceV2Client;
  sns: SNSClient;
  s3: S3Client;
};

export function createAwsSmsClients(account: ResolvedAwsSmsAccount): AwsSmsClients {
  if (!account.region) {
    throw new Error("AWS SMS requires a configured region or AWS_REGION.");
  }
  const clientConfig = { region: account.region };
  return {
    sms: new PinpointSMSVoiceV2Client(clientConfig),
    sns: new SNSClient(clientConfig),
    s3: new S3Client(clientConfig),
  };
}

export function resolveAwsSmsClientRegion(account: ResolvedAwsSmsAccount): string {
  const region = account.region.trim();
  if (!region) {
    throw new Error("AWS SMS requires a configured region or AWS_REGION.");
  }
  return region;
}
