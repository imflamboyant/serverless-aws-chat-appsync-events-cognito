# Post plan: Cognito auth and channel membership for the serverless chat

Part 5 of the serverless chat series. Previous parts used an API key for AppSync Events.

## Proposed sections

1. **What we're building**
   - Channels, users, and who sees what
   - Architecture
   - The memberships table
2. **Signing in with Cognito**
   - User pool and managed login
   - Sign-in with Amplify Auth: authorization code and PKCE
   - Creating users
3. **Cognito auth on both APIs**
   - Auth options for AppSync Events
   - The Event API: connect, publish and subscribe
   - The REST API: Cognito authorizer
   - Which token: ID or access
4. **Checking membership at every entry point**
   - Subscribe: onSubscribe and wildcards
   - Publish over WebSocket and HTTP: onPublish in one transaction
   - Message history and the channel list
5. **Running the demo**
   - Deploy
   - Create users
   - Run the client
   - Clean up
6. **Limits**
   - What happens when the token expires
   - What's left out

## Decisions

- **Membership key:** Cognito `sub`. It never changes and is in every token. Usernames can
  be reused after a user is deleted.
- **Memberships table:** separate from messages, keyed by `channel` + `userId`, with a
  `byUser` index for listing a user's channels.
- **Sign-in:** managed login, authorization code grant with PKCE, handled by Amplify Auth
  loaded from esm.sh, so the client still has no build step. Amplify is used for sign-in
  only: its Events client always sends the access token, and this project uses the ID token
  on every call.
- **Token:** the ID token for both APIs. The AppSync Events docs specify it for Cognito, and
  the API Gateway Cognito authorizer expects it when the method has no OAuth scopes.
- **Channels endpoint:** `GET /channels` returns the caller's channels and their members.
  It reads the user from the token, so there's no parameter to tamper with.

## Guard results

Checked during development by calling each entry point directly as carol, who isn't a
member of #engineering. The calls aren't in the post or the README; the findings can be.

| As carol                                              | Rejected by        | Result                  |
| ----------------------------------------------------- | ------------------ | ----------------------- |
| GET /channels                                         | Lambda             | #engineering not listed       |
| GET #engineering history                                    | Lambda             | 403 `Forbidden`         |
| Subscribe to #engineering over WebSocket                    | onSubscribe        | `subscribe_error`       |
| Subscribe to `/serverlesschat/channels/*`             | onSubscribe        | `subscribe_error`       |
| Subscribe to `/serverlesschat/*`                      | onSubscribe        | `subscribe_error`       |
| Publish to #engineering over WebSocket                      | onPublish          | `publish_error`         |
| Publish to #engineering via the Events HTTP endpoint        | onPublish          | 401                     |
| REST API, no token                                    | Cognito authorizer | 401                     |
| REST API, tampered token                              | Cognito authorizer | 403 `Access Denied`     |
| Events HTTP endpoint, no token                        | Event API auth     | 401                     |
| Events HTTP endpoint, tampered token                  | Event API auth     | 401                     |
| WebSocket connect, tampered token                     | Event API auth     | `connection_error` 401  |

Controls: carol gets 200 for #general history and `subscribe_success` for #general.

- After the rejected publishes, #engineering had 0 messages. The failed membership check cancels
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
- The Event API docs describe no server-side way to end a subscription. AppSync GraphQL APIs
  have one (subscription invalidation).
- If member removal is added later, two ways to make it take effect at once:
  - A generation number in the channel path, bumped on removal. The handlers accept only
    the current generation, so the old path goes quiet for the removed member.
  - One inbox channel per user, with a Lambda that checks membership and publishes to each
    member's inbox. One publish per member per message.

Side note: removing `idTokenValidity` from the CDK code doesn't reset Cognito's value.
CloudFormation drops the property and Cognito keeps the old setting, so the stack now sets
the 1-hour default explicitly.
