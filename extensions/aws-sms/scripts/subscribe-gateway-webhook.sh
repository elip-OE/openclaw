#!/usr/bin/env bash
set -euo pipefail

# Subscribe the gateway HTTPS webhook to the inbound SNS topic.
# Usage:
#   AWS_REGION=us-east-1 \
#   TOPIC_ARN=arn:aws:sns:us-east-1:123456789012:openclaw-aws-sms-inbound \
#   PUBLIC_WEBHOOK_URL=https://gateway.example.com/webhooks/aws-sms \
#   ./subscribe-gateway-webhook.sh

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
TOPIC_ARN="${TOPIC_ARN:-${AWS_SMS_INBOUND_TOPIC_ARN:-}}"
PUBLIC_WEBHOOK_URL="${PUBLIC_WEBHOOK_URL:-${AWS_SMS_PUBLIC_WEBHOOK_URL:-}}"

if [[ -z "${TOPIC_ARN}" || -z "${PUBLIC_WEBHOOK_URL}" ]]; then
  echo "TOPIC_ARN (or AWS_SMS_INBOUND_TOPIC_ARN) and PUBLIC_WEBHOOK_URL (or AWS_SMS_PUBLIC_WEBHOOK_URL) are required." >&2
  exit 1
fi

echo "Subscribing ${PUBLIC_WEBHOOK_URL} to ${TOPIC_ARN}..."
SUB_ARN="$(aws sns subscribe \
  --region "${REGION}" \
  --topic-arn "${TOPIC_ARN}" \
  --protocol https \
  --notification-endpoint "${PUBLIC_WEBHOOK_URL}" \
  --return-subscription-arn \
  --query SubscriptionArn --output text)"

echo "SUBSCRIPTION_ARN=${SUB_ARN}"
echo
echo "If the subscription is PendingConfirmation, either:"
echo "  1. Set channels.aws-sms.autoConfirmSnsSubscription=true and restart the gateway, or"
echo "  2. Confirm manually with the SubscribeURL/token from the SNS confirmation POST."
