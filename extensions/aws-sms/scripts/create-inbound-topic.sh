#!/usr/bin/env bash
set -euo pipefail

# Create the inbound SNS topic used by AWS End User Messaging SMS two-way messaging.
# Usage:
#   AWS_REGION=us-east-1 TOPIC_NAME=openclaw-aws-sms-inbound ./create-inbound-topic.sh

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
TOPIC_NAME="${TOPIC_NAME:-openclaw-aws-sms-inbound}"

echo "Creating SNS topic ${TOPIC_NAME} in ${REGION}..."
TOPIC_ARN="$(aws sns create-topic --region "${REGION}" --name "${TOPIC_NAME}" --query TopicArn --output text)"
echo "TOPIC_ARN=${TOPIC_ARN}"
echo
echo "Set this in OpenClaw config:"
echo "  channels.aws-sms.inboundSnsTopicArn=\"${TOPIC_ARN}\""
echo "or export:"
echo "  export AWS_SMS_INBOUND_TOPIC_ARN=\"${TOPIC_ARN}\""
