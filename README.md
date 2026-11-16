# Serverless Chat on AWS with AppSync Events and Cognito

A real-time chat on AWS AppSync Events where every user signs in with an Amazon Cognito
user pool, and channel membership is checked at every entry point. It continues the
[serverless chat series](https://github.com/imflamboyant/serverless-aws-chat): the API key
is gone, and so is the trust in whatever the client sends.

## What's in it

- **Cognito user pool** with managed login. The browser client signs in with the
  authorization code grant and PKCE, written by hand with no dependencies (`client/js/auth.js`).
- **AppSync Event API** with Cognito auth for connect, publish and subscribe. The
  `serverlesschat` namespace has two handlers (`src/appsyncjs/serverlesschat-handler.js`):
  - `onSubscribe` reads the membership item and rejects non-members and wildcard channels.
  - `onPublish` writes the messages in one DynamoDB transaction with a condition check on the
    membership item. The author comes from the token, not from the payload.
- **REST API** (API Gateway + Lambda) behind a Cognito authorizer:
  - `GET /channels`: the caller's channels and their members.
  - `GET /channels/{channel}/messages`: message history, members only.
- **DynamoDB**: a messages table, and a memberships table keyed by channel and Cognito `sub`.
- **Client** built with chat-ui-components, copied to `client/vendor/chat-ui`.

## Prerequisites

- Node.js 22 or later
- AWS CLI configured for the account and region to deploy to
- A CDK bootstrapped account (`npx cdk bootstrap`)
- Python 3, to serve the client locally

## Deploy

```shell
npm install
npm run deploy
```

`npm run deploy` writes the stack outputs to `cdk-outputs.json` and generates
`client/config.js` from them.

## Seed users and channels

CDK can't set Cognito passwords, so a script creates the users after the deploy. All three
users get the password from `SEED_PASSWORD`. It needs at least 8 characters with upper and
lower case letters, a number and a symbol.

```shell
SEED_PASSWORD='...' npm run seed
```

| User  | #general | #random | #leads |
| ----- | -------- | ------- | ------ |
| alice | ✓        | ✓       | ✓      |
| bob   | ✓        | ✓       | ✓      |
| carol | ✓        | ✓       |        |

## Run the client

```shell
npm run client
```

Open http://localhost:5173/ and sign in. To chat as several users at once, use a different
browser or browser profile per user. Incognito windows share storage in Chrome, so they
won't work.

## Prove the guards

The UI never offers #leads to carol, so the browser only proves the UI. The guard script
signs in as carol and calls each entry point directly:

```shell
SEED_PASSWORD='...' npm run guard
```

It posts two "guard test" messages to #general.

## Cleanup

```shell
npm run destroy
```
