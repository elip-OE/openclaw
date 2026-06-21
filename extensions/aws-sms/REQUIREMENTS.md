# AWS SMS Requirements

This document lists the operator requirements for the `@openclaw/aws-sms` channel plugin.

## AWS account prerequisites

- An AWS account with AWS End User Messaging SMS enabled in the target region.
- A dedicated SMS-capable origination identity:
  - E.164 phone number, phone-number id/ARN, or pool id/ARN for outbound SMS.
  - MMS-capable origination identity for outbound MMS (US/Canada only).
- A public HTTPS URL that reaches the OpenClaw Gateway webhook route.

## Credentials

The plugin uses the standard AWS credential chain only:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_SESSION_TOKEN` (optional)
- `AWS_PROFILE` (optional)
- Instance/task role credentials (optional)

No plugin-specific secret config fields are required.

## Required OpenClaw config

- `channels.aws-sms.region` or `AWS_REGION`
- `channels.aws-sms.originationIdentity` or `AWS_SMS_ORIGINATION_IDENTITY`
- `channels.aws-sms.fromNumber` or `AWS_SMS_FROM_NUMBER`
- `channels.aws-sms.inboundSnsTopicArn` or `AWS_SMS_INBOUND_TOPIC_ARN`
- `channels.aws-sms.publicWebhookUrl` or `AWS_SMS_PUBLIC_WEBHOOK_URL`
- `channels.aws-sms.mediaBucket` or `AWS_SMS_MEDIA_BUCKET` for outbound MMS

## IAM minimum policy

Use [`scripts/iam-policy-minimal.json`](scripts/iam-policy-minimal.json) as a starting point.

Required actions:

- Send: `sms-voice:SendTextMessage`, `sms-voice:SendMediaMessage`
- Read/probe: `sms-voice:DescribePhoneNumbers`, `sms-voice:DescribePools`
- Two-way setup: `sms-voice:UpdatePhoneNumber`
- SNS inbound: `sns:Subscribe`, `sns:ConfirmSubscription`, `sns:ListSubscriptionsByTopic`, `sns:GetTopicAttributes`
- MMS staging: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket` on the media bucket

## Household setup scripts

Run these from the plugin directory or reference them by repo path:

| Script                                 | Purpose                                |
| -------------------------------------- | -------------------------------------- |
| `scripts/create-inbound-topic.sh`      | Create the inbound SNS topic           |
| `scripts/subscribe-gateway-webhook.sh` | Subscribe the gateway HTTPS webhook    |
| `scripts/enable-two-way-sms.sh`        | Enable two-way SMS on the phone number |
| `scripts/create-mms-media-bucket.sh`   | Create the MMS staging bucket          |
| `scripts/verify-setup.sh`              | Read-only verification of the setup    |
| `scripts/iam-policy-minimal.json`      | Minimal IAM policy template            |

Example:

```bash
export AWS_REGION=us-east-1
export AWS_SMS_FROM_NUMBER=+15551234567
export AWS_SMS_PUBLIC_WEBHOOK_URL=https://gateway.example.com/webhooks/aws-sms

./extensions/aws-sms/scripts/create-inbound-topic.sh
./extensions/aws-sms/scripts/create-mms-media-bucket.sh
./extensions/aws-sms/scripts/subscribe-gateway-webhook.sh
./extensions/aws-sms/scripts/verify-setup.sh
```

## MMS constraints

- Outbound MMS is supported for US/Canada destinations only.
- Media must be staged in an S3 bucket in the same AWS account and region as the origination identity.
- AWS MMS file limit is 600 KB per file.
- **Inbound MMS is not supported by AWS.** Inbound SNS payloads remain text-only even when you send outbound MMS.

## Live proof checklist

1. Export AWS credentials and apply config/env vars.
2. Run the household scripts and `verify-setup.sh`.
3. Start the gateway and confirm the AWS SMS webhook route is registered.
4. Send an SMS to the origination number and approve pairing with `openclaw pairing approve aws-sms <code>`.
5. Confirm the agent replies over SMS.
6. Optional: send outbound MMS to a US/CA destination after configuring `mediaBucket`.
