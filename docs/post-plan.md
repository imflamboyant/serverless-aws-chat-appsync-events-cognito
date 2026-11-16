# Post plan: Cognito auth and channel membership for the serverless chat

Part 5 of the serverless chat series. Previous parts used an API key for AppSync Events.

## Outline

1. **Why.** An API key ships in the client, so anyone with it can read and write every
   channel. Goal: signed-in users only, and only in the channels they belong to.
2. **Cognito user pool and managed login.** No self sign-up. Public app client, code grant
   with PKCE. Managed login needs a branding style assigned to the client.
3. **Sign-in without dependencies.** `auth.js`: code challenge, redirect, code exchange,
   refresh. Why not Amplify: the client has no build step.
4. **Membership model.** Memberships table keyed by channel + Cognito `sub`, with a
   `byUser` index for "my channels". Why `sub` and not the username.
5. **One token for both APIs.** The ID token. AppSync Events documents it, and the API
   Gateway Cognito authorizer expects it when the method has no OAuth scopes.
6. **Event API auth.** Cognito for connect, publish and subscribe.
7. **onSubscribe with a DynamoDB data source.** Reject wildcards, check the membership item.
8. **onPublish in one call.** `ddb.transactWrite`: a condition check on the membership item
   and the message puts. Author from `ctx.identity`, not the payload. The Events HTTP
   endpoint runs the same handler, so it's covered too.
9. **REST API.** Cognito authorizer on every method, membership check in the Lambda,
   CORS on the authorizer's 4xx responses.
10. **Seeding.** AdminCreateUser + AdminSetUserPassword with `Permanent: true`.
11. **Proving the guards.** The guard script's output as a table.
12. **What's left out.** Membership management, invites, removing a member from open
    subscriptions.

## To find out while testing

- What happens to an open WebSocket and its subscriptions when the ID token expires. Test
  with the token validity set to 5 minutes, the Cognito minimum.
- The exact errors and status codes each guard returns, for the table in section 11.
