# Serverless Chat on AWS with AppSync Events and Cognito

A real-time chat on AWS AppSync Events where every user signs in with an Amazon Cognito
user pool, and channel membership is checked at every entry point. It continues the
[serverless chat series](https://github.com/imflamboyant/serverless-aws-chat): the API key
is gone, and so is the trust in whatever the client sends.

## What's in it

- **Cognito user pool** with managed login. The browser client signs in with the
  authorization code grant and PKCE, handled by Amplify Auth (`client/js/auth.js`). The page
  loads Amplify from [esm.sh](https://esm.sh), so there's no build step.
- **AppSync Event API** with Cognito auth for connect, publish and subscribe. The
  `serverlesschat` namespace has two handlers (`src/appsyncjs/serverlesschat-handler.js`):
  - `onSubscribe` reads the membership item and rejects non-members and wildcard channels.
  - `onPublish` writes the messages in one DynamoDB transaction with a condition check on the
    membership item.
- **REST API** (API Gateway + Lambda) behind a Cognito authorizer:
  - `GET /channels`: the caller's channels and their members.
  - `GET /channels/{channel}/messages`: message history, members only.
- **DynamoDB**: a messages table, and a memberships table keyed by channel and Cognito `sub`.
- **Client** built with chat-ui-components, copied to `client/vendor/chat-ui`.

## Prerequisites

Install these yourself:

| Tool | Version | Used for |
| --- | --- | --- |
| Node.js and npm | 24 or later | CDK, serving the client. The Lambdas also run on Node.js 24. |
| AWS CLI | v2 | Deploy credentials, `scripts/create-user.sh`, proving the guards |
| curl | any | Proving the guards |
| A POSIX shell | sh, bash or zsh | The scripts and commands. On Windows, use WSL. |

You also need:

- AWS credentials allowed to deploy CDK stacks and call the Cognito admin APIs, set up for
  the account and region to deploy to.
- The account and region bootstrapped for CDK, once: `npx cdk bootstrap`.

`npm install` installs the rest, pinned in `package.json`:

- `aws-cdk-lib` 2.245.0
- the CDK CLI (`aws-cdk`) 2.1114.1, run through `npx cdk` or the npm scripts
- TypeScript 5.6

There's no need to install the CDK CLI globally. `npx` downloads two more tools the first
time you use them: http-server, to serve the client, and wscat, to prove the guards over the
WebSocket.

Tested with Node.js 24, AWS CLI 2.32 and curl 8.7, on macOS in eu-central-1.

## Deploy

```shell
npm install
npm run deploy
```

The deploy prints the stack outputs. Export them for the next steps:

```shell
export USER_POOL_ID=<UserPoolId>
export CLIENT_ID=<UserPoolClientId>
export REST_API=<RestApiUrl>              # ends with a slash
export EVENTS_HTTP=<EventApiHttpDns>
export EVENTS_REALTIME=<EventApiRealtimeDns>
```

## Create users and channels

CDK can't set Cognito passwords, so `scripts/create-user.sh` creates each user after the
deploy. It runs three AWS CLI commands: create the user, set a permanent password, and write
one membership item per channel.

Replace `<password>` with a password of your choice. It needs at least 8 characters with upper
and lower case letters, a number and a symbol. Leave out single quotes, because the commands
wrap the password in them, and commas, because the sign-in command in
[Prove the guards](#prove-the-guards) splits on them.

```shell
./scripts/create-user.sh alice '<password>' general random engineering
./scripts/create-user.sh bob '<password>' general random engineering
./scripts/create-user.sh carol '<password>' general random
```

carol isn't a member of #engineering, so she's the one to test the membership checks with.

## Run the client

Copy `client/config.example.js` to `client/config.js` and fill in the values from the
deploy outputs. Then serve the client:

```shell
npm run client
```

Open http://localhost:5173/ and sign in. To chat as several users at once, use a different
browser or browser profile per user. Incognito windows share storage in Chrome, so they
won't work.

## Prove the guards

The UI never offers #engineering to carol, so the browser only shows that the UI hides it. The
commands below sign in as carol and call each entry point directly. The comments show what
each one returns.

Get carol's ID token. `ADMIN_USER_PASSWORD_AUTH` signs in with your AWS credentials, so no
browser is needed:

```shell
TOKEN=$(aws cognito-idp admin-initiate-auth \
  --user-pool-id "$USER_POOL_ID" --client-id "$CLIENT_ID" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters 'USERNAME=carol,PASSWORD=<password>' \
  --query AuthenticationResult.IdToken --output text)
```

### REST API

```shell
# carol's channels: #general and #random with their members, no #engineering
curl -s -H "Authorization: $TOKEN" "${REST_API}channels"

# #engineering history: {"message":"Forbidden"} 403, from the Lambda's membership check
curl -s -w ' %{http_code}\n' -H "Authorization: $TOKEN" "${REST_API}channels/engineering/messages"
```

### Events HTTP endpoint

```shell
# publish to #engineering: 401 "Not authorized to access channel", from onPublish
curl -s -w ' %{http_code}\n' "https://$EVENTS_HTTP/event" \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"channel":"/serverlesschat/channels/engineering","events":["{\"message\":\"hi\"}"]}'

```

### WebSocket

The token goes in twice: base64url-encoded in a subprotocol header to connect, and in the
`authorization` field of each message. [wscat](https://github.com/websockets/wscat) sends
one message with `-x` and waits 3 seconds for the reply with `-w 3`.

```shell
WS="wss://$EVENTS_REALTIME/event/realtime"
AUTH=$(printf '{"host":"%s","Authorization":"%s"}' "$EVENTS_HTTP" "$TOKEN")
HEADER=$(printf '%s' "$AUTH" | base64 | tr '+/' '-_' | tr -d '\n=')

# subscribe to #engineering: subscribe_error, from onSubscribe
SUBSCRIBE=$(printf '{"type":"subscribe","id":"1","channel":"%s","authorization":%s}' \
  /serverlesschat/channels/engineering "$AUTH")
npx wscat -s aws-appsync-event-ws -s "header-$HEADER" -c "$WS" -w 3 -x "$SUBSCRIBE"

# publish to #engineering: publish_error, from onPublish
PUBLISH=$(printf '{"type":"publish","id":"1","channel":"%s","events":["{\\"message\\":\\"hi\\"}"],"authorization":%s}' \
  /serverlesschat/channels/engineering "$AUTH")
npx wscat -s aws-appsync-event-ws -s "header-$HEADER" -c "$WS" -w 3 -x "$PUBLISH"
```

To try the wildcards, replace `/serverlesschat/channels/engineering` in `SUBSCRIBE` with
`/serverlesschat/channels/*` or `/serverlesschat/*`: both get `subscribe_error`. With
`/serverlesschat/channels/general`, carol gets `subscribe_success`.

### No token or a tampered token

```shell
TAMPERED="${TOKEN%?????}AAAAA"   # breaks the signature

# REST API: no token 401, tampered token {"message":"Access Denied"} 403, from the Cognito authorizer
curl -s -w ' %{http_code}\n' "${REST_API}channels/general/messages"
curl -s -w ' %{http_code}\n' -H "Authorization: $TAMPERED" "${REST_API}channels/general/messages"

# Events HTTP endpoint: 401 for both
curl -s -w ' %{http_code}\n' "https://$EVENTS_HTTP/event" -H 'Content-Type: application/json' \
  -d '{"channel":"/serverlesschat/channels/general","events":["{\"message\":\"hi\"}"]}'
curl -s -w ' %{http_code}\n' "https://$EVENTS_HTTP/event" -H "Authorization: $TAMPERED" -H 'Content-Type: application/json' \
  -d '{"channel":"/serverlesschat/channels/general","events":["{\"message\":\"hi\"}"]}'

# WebSocket connect: connection_error, 401
BAD=$(printf '{"host":"%s","Authorization":"%s"}' "$EVENTS_HTTP" "$TAMPERED" \
  | base64 | tr '+/' '-_' | tr -d '\n=')
npx wscat -s aws-appsync-event-ws -s "header-$BAD" -c "$WS" -w 3 -x '{"type":"connection_init"}'
```


## Cleanup

```shell
npm run destroy
```
