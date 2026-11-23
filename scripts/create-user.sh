#!/bin/sh
# Creates a Cognito user and adds it to channels.
# Usage: ./scripts/create-user.sh <UserPoolId> <username> <password> <channel>...
# Needs the AWS CLI. <UserPoolId> is the UserPoolId output of the deploy.
set -eu

if [ $# -lt 4 ]; then
  echo "Usage: $0 <UserPoolId> <username> <password> <channel>..." >&2
  exit 1
fi
USER_POOL_ID=$1
USERNAME=$2
PASSWORD=$3
shift 3

# no invitation email; prints the user's sub, the key of the membership items
SUB=$(aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" --username "$USERNAME" \
  --message-action SUPPRESS \
  --query "User.Attributes[?Name=='sub'].Value" --output text)

# permanent: no forced password change on first sign-in
aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" --username "$USERNAME" \
  --password "$PASSWORD" --permanent

for CHANNEL in "$@"; do
  aws dynamodb put-item --table-name serverless-chat-cognito-memberships \
    --item "$(printf '{"channel":{"S":"%s"},"userId":{"S":"%s"},"username":{"S":"%s"}}' \
      "$CHANNEL" "$SUB" "$USERNAME")"
done

echo "$USERNAME ($SUB): $*"
