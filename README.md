# Serverless Chat on AWS with AppSync Events and Cognito

A real-time chat on AWS AppSync Events where every user signs in with an Amazon Cognito
user pool, and channel membership is checked at every entry point.

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
| AWS CLI | v2 | Deploy credentials, `scripts/create-user.sh` |
| A POSIX shell | sh, bash or zsh | The scripts and commands. On Windows, use WSL. |

You also need:

- AWS credentials allowed to deploy CDK stacks and call the Cognito admin APIs, set up for
  the account and region to deploy to.
- The account and region bootstrapped for CDK, once: `npx cdk bootstrap`.

`npm install` installs the rest, pinned in `package.json`:

- `aws-cdk-lib` 2.245.0
- the CDK CLI (`aws-cdk`) 2.1114.1, run through `npx cdk` or the npm scripts
- TypeScript 5.6

There's no need to install the CDK CLI globally. `npx` downloads http-server, which serves the
client, the first time you run it.

Tested with Node.js 24 and AWS CLI 2.32, on macOS in eu-central-1.

## Deploy

```shell
npm install
npm run deploy
```

The deploy prints the stack outputs. Export the user pool id for the next step:

```shell
export USER_POOL_ID=<UserPoolId>
```

## Create users and channels

CDK can't set Cognito passwords, so `scripts/create-user.sh` creates each user after the
deploy. It runs three AWS CLI commands: create the user, set a permanent password, and write
one membership item per channel.

Replace `<password>` with a password of your choice. It needs at least 8 characters with upper
and lower case letters, a number and a symbol. Leave out single quotes, because the commands
wrap the password in them.

```shell
./scripts/create-user.sh alice '<password>' general random engineering
./scripts/create-user.sh bob '<password>' general random engineering
./scripts/create-user.sh carol '<password>' general random
```

carol isn't a member of #engineering, so she won't see it in the chat.

## Run the client

Copy `client/config.example.js` to `client/config.js` and fill in the values from the
deploy outputs. Then serve the client:

```shell
npm run client
```

Open http://localhost:5173/ and sign in. To chat as several users at once, use a different
browser or browser profile per user. Incognito windows share storage in Chrome, so they
won't work.

## Cleanup

```shell
npm run destroy
```
