# @openclaw/aws-sms

Official AWS End User Messaging SMS channel plugin for **OpenClaw**.

Features:

- Outbound SMS via `SendTextMessage`
- Outbound MMS via `SendMediaMessage` with S3 staging
- Inbound SMS via SNS HTTPS webhook subscriptions
- Default AWS credential chain (`AWS_*` env vars or instance role)
- Operator setup scripts and requirements in this package

Docs: `https://docs.openclaw.ai/channels/aws-sms`

## Quick config

```json5
{
  channels: {
    "aws-sms": {
      enabled: true,
      region: "us-east-1",
      originationIdentity: "+15551234567",
      fromNumber: "+15551234567",
      inboundSnsTopicArn: "arn:aws:sns:us-east-1:123456789012:openclaw-aws-sms-inbound",
      publicWebhookUrl: "https://gateway.example.com/webhooks/aws-sms",
      mediaBucket: "openclaw-aws-sms-media-us-east-1",
      dmPolicy: "pairing",
    },
  },
}
```

## Household scripts

See [`REQUIREMENTS.md`](REQUIREMENTS.md) and [`scripts/`](scripts/) for:

- SNS topic creation
- HTTPS webhook subscription
- Two-way SMS enablement
- MMS media bucket creation
- Read-only setup verification
- Minimal IAM policy template

## Send targets

```bash
openclaw message send --channel aws-sms --target aws-sms:+15557654321 --message "hello"
```

## Agent tool

The `aws_sms` agent tool supports:

- `list_numbers`
- `describe_number`
- `describe_pool`
- `probe_inbound`
- `print_setup_scripts`
