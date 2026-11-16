// Creates the Cognito users and their channel memberships. Safe to run again.
// Usage: SEED_PASSWORD='...' npm run seed
import {
    AdminCreateUserCommand,
    AdminGetUserCommand,
    AdminSetUserPasswordCommand,
    CognitoIdentityProviderClient,
    UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { stackOutputs } from './outputs.mjs';

const USERS = [
    { username: 'alice', name: 'Alice Anderson' },
    { username: 'bob', name: 'Bob Baker' },
    { username: 'carol', name: 'Carol Chen' },
];
// carol isn't a member of #leads, the guard script uses her to test the checks
const CHANNELS = {
    general: ['alice', 'bob', 'carol'],
    random: ['alice', 'bob', 'carol'],
    leads: ['alice', 'bob'],
};

const password = process.env.SEED_PASSWORD;
if (!password) {
    console.error('Set SEED_PASSWORD (at least 8 characters with upper and lower case, a number and a symbol).');
    process.exit(1);
}

const { UserPoolId, MembershipsTableName } = stackOutputs();
const cognito = new CognitoIdentityProviderClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const subOf = (attributes) => attributes.find((a) => a.Name === 'sub').Value;

// Create the user, or look it up when it already exists. Returns the Cognito sub.
async function ensureUser({ username, name }) {
    let sub;
    try {
        const created = await cognito.send(new AdminCreateUserCommand({
            UserPoolId,
            Username: username,
            UserAttributes: [{ Name: 'name', Value: name }],
            MessageAction: 'SUPPRESS', // no invitation email
        }));
        sub = subOf(created.User.Attributes);
    } catch (err) {
        if (!(err instanceof UsernameExistsException)) throw err;
        const existing = await cognito.send(new AdminGetUserCommand({ UserPoolId, Username: username }));
        sub = subOf(existing.UserAttributes);
    }
    // Permanent: true skips the forced password change on first sign-in
    await cognito.send(new AdminSetUserPasswordCommand({
        UserPoolId,
        Username: username,
        Password: password,
        Permanent: true,
    }));
    return sub;
}

const users = {};
for (const user of USERS) {
    users[user.username] = { ...user, sub: await ensureUser(user) };
    console.log(`user ${user.username}: ${users[user.username].sub}`);
}

for (const [channel, usernames] of Object.entries(CHANNELS)) {
    for (const username of usernames) {
        const { sub, name } = users[username];
        await ddb.send(new PutCommand({
            TableName: MembershipsTableName,
            Item: { channel, userId: sub, username, name },
        }));
    }
    console.log(`#${channel}: ${usernames.join(', ')}`);
}
