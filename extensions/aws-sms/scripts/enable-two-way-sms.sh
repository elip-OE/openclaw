#!/usr/bin/env bash
set -euo pipefail

# Enable two-way SMS on an AWS End User Messaging SMS phone number.
# Usage:
#   AWS_REGION=us-east-1 \
#   PHONE_NUMBER_ID=phone-number-id-or-arn \
#   TOPIC_ARN=arn:aws:sns:us-east-1:123456789012:openclaw-aws-sms-inbound \
#   TWO_WAY_ROLE_ARN=arn:aws:iam::123456789012:role/openclaw-aws-sms-two-way \
#   ./enable-two-way-sms.sh

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
PHONE_NUMBER_ID="${PHONE_NUMBER_ID:-${AWS_SMS_PHONE_NUMBER_ID:-}}"
TOPIC_ARN="${TOPIC_ARN:-${AWS_SMS_INBOUND_TOPIC_ARN:-}}"
TWO_WAY_ROLE_ARN="${TWO_WAY_ROLE_ARN:-${AWS_SMS_TWO_WAY_ROLE_ARN:-}}"

if [[ -z "${PHONE_NUMBER_ID}" || -z "${TOPIC_ARN}" || -z "${TWO_WAY_ROLE_ARN}" ]]; then
  echo "PHONE_NUMBER_ID, TOPIC_ARN, and TWO_WAY_ROLE_ARN are required." >&2
  exit 1
fi

echo "Enabling two-way SMS for ${PHONE_NUMBER_ID} -> ${TOPIC_ARN}..."
aws pinpoint-sms-voice-v2 update-phone-number \
  --region "${REGION}" \
  --phone-number-id "${PHONE_NUMBER_ID}" \
  --two-way-enabled \
  --two-way-channel-arn "${TOPIC_ARN}" \
  --two-way-channel-role "${TWO_WAY_ROLE_ARN}"

echo "Two-way SMS enabled."
