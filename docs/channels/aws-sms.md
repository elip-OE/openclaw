---
summary: "AWS End User Messaging SMS channel setup, MMS outbound, SNS inbound webhooks, and household scripts"
read_when:
  - You want to connect OpenClaw to SMS through AWS
  - You need AWS SMS webhook, MMS bucket, or IAM setup
title: "AWS SMS"
---

OpenClaw can receive and send SMS through AWS End User Messaging SMS. The Gateway registers an SNS HTTPS webhook route, validates SNS signatures, sends outbound SMS with `SendTextMessage`, and sends outbound MMS with `SendMediaMessage` after staging media in S3.

<CardGroup cols={3}>
  <Card title="Pairing" icon="link" href="/channels/pairing">
    Default DM policy for AWS SMS is pairing.
  </Card>
  <Card title="Gateway security" icon="shield" href="/gateway/security">
    Review webhook exposure and sender access controls.
  </Card>
  <Card title="Channel troubleshooting" icon="wrench" href="/channels/troubleshooting">
    Cross-channel diagnostics and repair playbooks.
  </Card>
</CardGroup>

## Before you begin

You need:

- An AWS account with End User Messaging SMS enabled in your target region.
- An SMS-capable origination identity (phone number or pool).
- AWS credentials available to the Gateway host through the standard AWS credential chain.
- A public HTTPS URL that reaches your OpenClaw Gateway.
- An SNS topic wired for two-way SMS on your origination number.

For outbound MMS you also need:

- An MMS-capable origination identity (US/Canada only).
- An S3 bucket in the same AWS account and region as the origination identity.

## Requirements

See the bundled plugin requirements doc at `extensions/aws-sms/REQUIREMENTS.md` for:

- IAM minimum actions
- Credential expectations
- MMS constraints
- Live proof checklist

## Household setup scripts

The plugin ships operator scripts under `extensions/aws-sms/scripts/`:

| Script                         | Purpose                                |
| ------------------------------ | -------------------------------------- |
| `create-inbound-topic.sh`      | Create the inbound SNS topic           |
| `subscribe-gateway-webhook.sh` | Subscribe the gateway HTTPS webhook    |
| `enable-two-way-sms.sh`        | Enable two-way SMS on the phone number |
| `create-mms-media-bucket.sh`   | Create the MMS staging bucket          |
| `verify-setup.sh`              | Read-only setup verification           |
| `iam-policy-minimal.json`      | Minimal IAM policy template            |

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

The `aws_sms` agent tool action `print_setup_scripts` returns the same script list at runtime.

## Quick setup

<Steps>
  <Step title="Configure AWS SMS">

Save this as `aws-sms.patch.json5` and change the placeholders:

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

Apply it:

```bash
openclaw config patch --file ./aws-sms.patch.json5 --dry-run
openclaw config patch --file ./aws-sms.patch.json5
```

  </Step>

  <Step title="Run household scripts">

Create the SNS topic, MMS bucket, HTTPS subscription, and two-way SMS wiring with the scripts in `extensions/aws-sms/scripts/`.

  </Step>

  <Step title="Start the gateway">

```bash
openclaw gateway
```

  </Step>

  <Step title="Approve first pairing request">

```bash
openclaw pairing list aws-sms
openclaw pairing approve aws-sms <CODE>
```

  </Step>
</Steps>

## Environment variables

For single-account deployments:

```bash
export AWS_REGION="us-east-1"
export AWS_SMS_ORIGINATION_IDENTITY="+15551234567"
export AWS_SMS_FROM_NUMBER="+15551234567"
export AWS_SMS_INBOUND_TOPIC_ARN="arn:aws:sns:us-east-1:123456789012:openclaw-aws-sms-inbound"
export AWS_SMS_PUBLIC_WEBHOOK_URL="https://gateway.example.com/webhooks/aws-sms"
export AWS_SMS_MEDIA_BUCKET="openclaw-aws-sms-media-us-east-1"
```

Then enable the channel in config:

```json5
{
  channels: {
    "aws-sms": {
      enabled: true,
      dmPolicy: "pairing",
    },
  },
}
```

## Sending messages

Outbound SMS and MMS targets use the `aws-sms:` prefix:

```bash
openclaw message send --channel aws-sms --target aws-sms:+15551234567 --message "hello"
```

Agent replies from inbound AWS SMS conversations automatically go back to the sender through the configured origination identity.

SMS output is plain text. OpenClaw strips markdown, flattens fenced code blocks, preserves readable links, and chunks long replies before sending them through AWS.

Outbound MMS uses the configured S3 media bucket. AWS does not deliver inbound MMS media on SNS; inbound remains text-only even after outbound MMS.

## Verify setup

```bash
openclaw channels capabilities --channel aws-sms
openclaw channels status --channel aws-sms --probe --json
./extensions/aws-sms/scripts/verify-setup.sh
```

## Access control

`channels.aws-sms.dmPolicy` controls direct SMS access:

- `pairing` (default)
- `allowlist`
- `open` (requires `allowFrom` to include `"*"`)
- `disabled`

`allowFrom` entries should be E.164 phone numbers such as `+15551234567`.

## Webhook security

By default, OpenClaw validates SNS message signatures for inbound HTTPS subscriptions. Keep `publicWebhookUrl` aligned with the SNS subscription endpoint.

Optional automatic SNS subscription confirmation:

```json5
{
  channels: {
    "aws-sms": {
      autoConfirmSnsSubscription: true,
    },
  },
}
```

Leave this disabled unless you trust automatic confirmation for the gateway host.

## Troubleshooting

### No inbound messages arrive

Check in this order:

- Two-way SMS is enabled on the origination number.
- The inbound SNS topic matches `inboundSnsTopicArn`.
- SNS has an HTTPS subscription for `publicWebhookUrl`.
- The gateway log shows the AWS SMS webhook route.
- Run `./extensions/aws-sms/scripts/verify-setup.sh`.

### Outbound MMS fails

Confirm:

- `mediaBucket` exists in the same region/account as the origination identity.
- The origination identity is MMS-capable.
- The destination is in the US or Canada.
- Media files are within AWS MMS size limits.

### Outbound SMS fails

Confirm AWS credentials, `region`, and `originationIdentity` are resolved. Use:

```bash
openclaw channels status --channel aws-sms --probe --json
```
