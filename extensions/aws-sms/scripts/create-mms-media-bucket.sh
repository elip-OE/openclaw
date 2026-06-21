#!/usr/bin/env bash
set -euo pipefail

# Create the regional S3 bucket used to stage outbound MMS media.
# Usage:
#   AWS_REGION=us-east-1 BUCKET_NAME=openclaw-aws-sms-media ./create-mms-media-bucket.sh

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
BUCKET_NAME="${BUCKET_NAME:-${AWS_SMS_MEDIA_BUCKET:-openclaw-aws-sms-media-${REGION}}}"

echo "Creating S3 bucket ${BUCKET_NAME} in ${REGION}..."
if [[ "${REGION}" == "us-east-1" ]]; then
  aws s3api create-bucket --bucket "${BUCKET_NAME}" --region "${REGION}"
else
  aws s3api create-bucket \
    --bucket "${BUCKET_NAME}" \
    --region "${REGION}" \
    --create-bucket-configuration "LocationConstraint=${REGION}"
fi

POLICY_FILE="$(mktemp)"
cat > "${POLICY_FILE}" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowEumSmsRead",
      "Effect": "Allow",
      "Principal": {
        "Service": "sms-voice.amazonaws.com"
      },
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::${BUCKET_NAME}/*"
    }
  ]
}
EOF

aws s3api put-bucket-policy --bucket "${BUCKET_NAME}" --policy "file://${POLICY_FILE}"
rm -f "${POLICY_FILE}"

echo "BUCKET_NAME=${BUCKET_NAME}"
echo
echo "Set this in OpenClaw config:"
echo "  channels.aws-sms.mediaBucket=\"${BUCKET_NAME}\""
echo "or export:"
echo "  export AWS_SMS_MEDIA_BUCKET=\"${BUCKET_NAME}\""
