# Post plan: Cognito auth and channel membership for the serverless chat

Part 5 of the serverless chat series. Previous parts used an API key for AppSync Events.

## Proposed section titles

1. Why the API key has to go
2. What we're building
3. A Cognito user pool with managed login
4. Signing in without a library: authorization code and PKCE
5. Who is a member of which channel
6. One token for both APIs
7. Cognito auth on the Event API
8. Checking membership on subscribe
9. Checking membership on publish, in one DynamoDB transaction
10. Never trust the author in the payload
11. Cognito auth and membership checks on the REST API
12. Seeding users and memberships
13. Proving the guards
14. What happens when the token expires
15. What's left out

## Decisions

- **Membership key:** Cognito `sub`. It never changes and is in every token. Usernames can
  be reused after a user is deleted.
- **Memberships table:** separate from messages, keyed by `channel` + `userId`, with a
  `byUser` index for listing a user's channels.
- **Sign-in:** managed login, authorization code grant with PKCE, written by hand
  (`client/js/auth.js`). No Amplify, because the client has no build step.
- **Token:** the ID token for both APIs. The AppSync Events docs specify it for Cognito, and
  the API Gateway Cognito authorizer expects it when the method has no OAuth scopes.
- **Author:** taken from `ctx.identity` in onPublish, never from the message payload.
- **Channels endpoint:** `GET /channels` returns the caller's channels and their members.
  It reads the user from the token, so there's no parameter to tamper with.

## Guard results

From `npm run guard`, signed in as carol, who isn't a member of #leads.

| As carol                                              | Rejected by        | Result                  |
| ----------------------------------------------------- | ------------------ | ----------------------- |
| GET /channels                                         | Lambda             | #leads not listed       |
| GET #leads history                                    | Lambda             | 403 `Forbidden`         |
| Subscribe to #leads over WebSocket                    | onSubscribe        | `subscribe_error`       |
| Subscribe to `/serverlesschat/channels/*`             | onSubscribe        | `subscribe_error`       |
| Subscribe to `/serverlesschat/*`                      | onSubscribe        | `subscribe_error`       |
| Publish to #leads over WebSocket                      | onPublish          | `publish_error`         |
| Publish to #leads via the Events HTTP endpoint        | onPublish          | 401                     |
| Publish to #general with `username: alice` in payload | onPublish          | stored author is carol  |
| REST API, no token                                    | Cognito authorizer | 401                     |
| REST API, tampered token                              | Cognito authorizer | 403 `Access Denied`     |
| Events HTTP endpoint, no token                        | Event API auth     | 401                     |
| Events HTTP endpoint, tampered token                  | Event API auth     | 401                     |
| WebSocket connect, tampered token                     | Event API auth     | connection refused      |

Controls: carol gets 200 for #general history and `subscribe_success` for #general.

- After the rejected publishes, #leads had 0 messages. The failed membership check cancels
  the whole transaction, so nothing is written.
- API Gateway answers a bad token with 403 `Access Denied`, not 401. The non-member 403
  comes from our Lambda, with the message `Forbidden`.

## Token expiry on an open WebSocket

Tested with the ID token validity set to 5 minutes, the Cognito minimum.

- The connection stays open after the token expires, and keep-alives continue.
- The existing subscription keeps delivering. Events arrived 1 and 3 minutes after expiry.
- New operations with the expired token fail: `subscribe_error` and `publish_error`, both
  `UnauthorizedException` with the message "Token has expired."
- New operations with a fresh token on the same connection succeed. No reconnect is needed.
  The client refreshes the token before each publish and subscribe.
- So membership is checked once per subscription. Removing a member, or disabling the user,
  doesn't end an open subscription. It runs until the client unsubscribes or the connection
  closes, which AppSync does after 24 hours at most. I only observed up to 3 minutes after
  expiry; the 24 hours comes from the WebSocket protocol docs.

Side note: removing `idTokenValidity` from the CDK code doesn't reset Cognito's value.
CloudFormation drops the property and Cognito keeps the old setting, so the stack now sets
the 1-hour default explicitly.
