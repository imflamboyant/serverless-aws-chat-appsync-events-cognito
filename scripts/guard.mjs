// Proves the membership checks: calls every entry point directly, bypassing the UI,
// as carol, who isn't a member of #leads.
// Usage: SEED_PASSWORD='...' npm run guard
import { AdminInitiateAuthCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { stackOutputs } from './outputs.mjs';

const password = process.env.SEED_PASSWORD;
if (!password) {
    console.error('Set SEED_PASSWORD to the password used by the seed script.');
    process.exit(1);
}
const outputs = stackOutputs();
const restApi = outputs.RestApiUrl.replace(/\/$/, '');
const httpDns = outputs.EventApiHttpDns;
const LEADS = '/serverlesschat/channels/leads';
const GENERAL = '/serverlesschat/channels/general';

// Sign in as carol with ADMIN_USER_PASSWORD_AUTH, using your AWS credentials
const cognito = new CognitoIdentityProviderClient({});
const signIn = await cognito.send(new AdminInitiateAuthCommand({
    UserPoolId: outputs.UserPoolId,
    ClientId: outputs.UserPoolClientId,
    AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
    AuthParameters: { USERNAME: 'carol', PASSWORD: password },
}));
const token = signIn.AuthenticationResult.IdToken;

// Tampered token: claims to be another user, keeps carol's signature
const [header, payload, signature] = token.split('.');
const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
const forged = Buffer.from(JSON.stringify({ ...claims, sub: '00000000-0000-0000-0000-000000000000' })).toString('base64url');
const tampered = [header, forged, signature].join('.');

const authHeader = (t) => (t ? { Authorization: t } : {});

async function get(path, t) {
    return fetch(restApi + path, { headers: authHeader(t) });
}

async function httpPublish(channel, event, t) {
    const response = await fetch(`https://${httpDns}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(t) },
        body: JSON.stringify({ channel, events: [JSON.stringify(event)] }),
    });
    return response.status;
}

// One operation on a fresh WebSocket connection. Resolves with the reply type.
function ws(t, operation) {
    return new Promise((resolve) => {
        const authorization = { host: httpDns, Authorization: t };
        const protocol = `header-${Buffer.from(JSON.stringify(authorization)).toString('base64url')}`;
        const socket = new WebSocket(`wss://${outputs.EventApiRealtimeDns}/event/realtime`, ['aws-appsync-event-ws', protocol]);
        let finished = false;
        const done = (result) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            socket.close();
            resolve(result);
        };
        const timer = setTimeout(() => done('timeout'), 10_000);
        socket.onopen = () => socket.send(JSON.stringify({ type: 'connection_init' }));
        socket.onmessage = (e) => {
            const message = JSON.parse(e.data);
            if (message.type === 'connection_ack') {
                socket.send(JSON.stringify({ ...operation, id: 'guard', authorization }));
            } else if (message.id === 'guard') {
                done(message.type);
            } else if (message.type.includes('error')) {
                done('connection rejected');
            }
        };
        socket.onerror = () => done('connection rejected');
        socket.onclose = () => done('connection rejected');
    });
}

const subscribe = (channel) => ({ type: 'subscribe', channel });
const publish = (channel, event) => ({ type: 'publish', channel, events: [JSON.stringify(event)] });

const checks = [
    ['GET /channels lists #leads', 'no', async () => {
        const channels = await (await get('/channels', token)).json();
        return channels.some((c) => c.id === 'leads') ? 'yes' : 'no';
    }],
    ['GET #leads history', 403, async () => (await get('/channels/leads/messages', token)).status],
    ['WebSocket subscribe to #leads', 'subscribe_error', () => ws(token, subscribe(LEADS))],
    ['WebSocket subscribe to /serverlesschat/channels/*', 'subscribe_error', () => ws(token, subscribe('/serverlesschat/channels/*'))],
    ['WebSocket subscribe to /serverlesschat/*', 'subscribe_error', () => ws(token, subscribe('/serverlesschat/*'))],
    ['WebSocket publish to #leads', 'publish_error', () => ws(token, publish(LEADS, { message: 'guard test' }))],
    ['HTTP publish to #leads', 401, () => httpPublish(LEADS, { message: 'guard test' }, token)],
    ['Publish to #general claiming to be alice, stored author', 'carol', async () => {
        await httpPublish(GENERAL, { message: 'guard test: spoofed author', username: 'alice', userId: 'alice' }, token);
        const history = await (await get('/channels/general/messages', token)).json();
        return history.at(-1).username;
    }],
    ['GET #general history, no token', 401, async () => (await get('/channels/general/messages')).status],
    ['GET #general history, tampered token', 401, async () => (await get('/channels/general/messages', tampered)).status],
    ['HTTP publish to #general, no token', 401, () => httpPublish(GENERAL, { message: 'guard test' })],
    ['HTTP publish to #general, tampered token', 401, () => httpPublish(GENERAL, { message: 'guard test' }, tampered)],
    ['WebSocket connect, tampered token', 'connection rejected', () => ws(tampered, subscribe(GENERAL))],
    // controls: carol can use the channels she is a member of
    ['GET #general history (member)', 200, async () => (await get('/channels/general/messages', token)).status],
    ['WebSocket subscribe to #general (member)', 'subscribe_success', () => ws(token, subscribe(GENERAL))],
];

let failed = 0;
for (const [name, expected, run] of checks) {
    const actual = await run().catch((err) => `error: ${err.message}`);
    const pass = actual === expected;
    if (!pass) failed++;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(55)} expected ${expected}, got ${actual}`);
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
