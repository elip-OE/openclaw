#!/usr/bin/env bash
set -euo pipefail

# Read-only setup verification for AWS SMS channel prerequisites.
# Usage:
#   AWS_REGION=us-east-1 \
#   AWS_SMS_FROM_NUMBER=+15551234567 \
#   AWS_SMS_INBOUND_TOPIC_ARN=arn:aws:sns:... \
#   AWS_SMS_PUBLIC_WEBHOOK_URL=https://gateway.example.com/webhooks/aws-sms \
#   AWS_SMS_MEDIA_BUCKET=openclaw-aws-sms-media \
#   ./verify-setup.sh

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
FROM_NUMBER="${AWS_SMS_FROM_NUMBER:-}"
TOPIC_ARN="${AWS_SMS_INBOUND_TOPIC_ARN:-}"
PUBLIC_WEBHOOK_URL="${AWS_SMS_PUBLIC_WEBHOOK_URL:-}"
MEDIA_BUCKET="${AWS_SMS_MEDIA_BUCKET:-}"

fail=0

echo "Checking AWS credentials..."
if ! aws sts get-caller-identity --region "${REGION:-us-east-1}" >/dev/null 2>&1; then
  echo "FAIL: AWS credentials are not available to the AWS CLI." >&2
  fail=1
else
  echo "OK: AWS credentials available."
fi

if [[ -n "${REGION}" ]]; then
  echo "Region: ${REGION}"
else
  echo "WARN: AWS_REGION is not set."
fi

if [[ -n "${FROM_NUMBER}" && -n "${REGION}" ]]; then
  echo "Checking phone number ${FROM_NUMBER}..."
  if aws pinpoint-sms-voice-v2 describe-phone-numbers \
    --region "${REGION}" \
    --phone-numbers "${FROM_NUMBER}" >/dev/null 2>&1; then
    echo "OK: Phone number is visible to DescribePhoneNumbers."
  else
    echo "FAIL: DescribePhoneNumbers could not find ${FROM_NUMBER}." >&2
    fail=1
  fi
else
  echo "SKIP: AWS_SMS_FROM_NUMBER or AWS_REGION not set."
fi

if [[ -n "${TOPIC_ARN}" && -n "${REGION}" ]]; then
  echo "Checking SNS topic ${TOPIC_ARN}..."
  if aws sns get-topic-attributes --region "${REGION}" --topic-arn "${TOPIC_ARN}" >/dev/null 2>&1; then
    echo "OK: SNS topic exists."
  else
    echo "FAIL: SNS topic is not reachable." >&2
    fail=1
  fi
  if [[ -n "${PUBLIC_WEBHOOK_URL}" ]]; then
    echo "Checking HTTPS subscription for ${PUBLIC_WEBHOOK_URL}..."
    if aws sns list-subscriptions-by-topic --region "${REGION}" --topic-arn "${TOPIC_ARN}" \
      --output text | grep -Fq "${PUBLIC_WEBHOOK_URL}"; then
      echo "OK: HTTPS subscription endpoint found."
    else
      echo "FAIL: No HTTPS subscription matches public webhook URL." >&2
      fail=1
    fi
  fi
else
  echo "SKIP: AWS_SMS_INBOUND_TOPIC_ARN or AWS_REGION not set."
fi

if [[ -n "${MEDIA_BUCKET}" && -n "${REGION}" ]]; then
  echo "Checking MMS bucket ${MEDIA_BUCKET}..."
  if aws s3api head-bucket --bucket "${MEDIA_BUCKET}" >/dev/null 2>&1; then
    echo "OK: MMS bucket exists."
  else
    echo "FAIL: MMS bucket is not reachable." >&2
    fail=1
  fi
else
  echo "SKIP: AWS_SMS_MEDIA_BUCKET not set."
fi

if [[ "${fail}" -ne 0 ]]; then
  echo "Verification failed." >&2
  exit 1
fi

echo "Verification passed."
