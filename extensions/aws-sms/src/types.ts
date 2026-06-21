// Aws Sms type declarations define plugin contracts.

export type AwsSmsChannelConfigFields = {
  enabled?: boolean;
  region?: string;
  originationIdentity?: string;
  fromNumber?: string;
  inboundSnsTopicArn?: string;
  mediaBucket?: string;
  defaultTo?: string;
  webhookPath?: string;
  publicWebhookUrl?: string;
  autoConfirmSnsSubscription?: boolean;
  dmPolicy?: "pairing" | "open" | "allowlist" | "disabled";
  allowFrom?: string | Array<string | number>;
  textChunkLimit?: number;
  mediaMaxMb?: number;
};

export interface AwsSmsChannelConfig extends AwsSmsChannelConfigFields {
  accounts?: Record<string, AwsSmsAccountRaw>;
  defaultAccount?: string;
}

export interface AwsSmsAccountRaw extends AwsSmsChannelConfigFields {}

export interface ResolvedAwsSmsAccount {
  accountId: string;
  enabled: boolean;
  region: string;
  originationIdentity: string;
  fromNumber: string;
  inboundSnsTopicArn: string;
  mediaBucket: string;
  defaultTo: string;
  webhookPath: string;
  publicWebhookUrl: string;
  autoConfirmSnsSubscription: boolean;
  dmPolicy: "pairing" | "open" | "allowlist" | "disabled";
  allowFrom: string[];
  textChunkLimit: number;
  mediaMaxMb: number;
}

export interface AwsSmsInboundMessage {
  messageId: string;
  from: string;
  to: string;
  body: string;
  previousPublishedMessageId?: string;
}

export type AwsSmsSendResult = {
  messageId: string;
  to: string;
  from?: string;
};
