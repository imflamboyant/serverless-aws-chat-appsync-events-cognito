import {APIGatewayProxyEvent, APIGatewayProxyResult} from 'aws-lambda';
import {QueryCommand} from '@aws-sdk/lib-dynamodb';
import {callerId, ddb, json} from './shared';

// GET /channels: the caller's channels, each with its members.
// The user comes from the token, so there is no parameter to tamper with.
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const userId = callerId(event);
    const memberships = await ddb.send(new QueryCommand({
        TableName: process.env.MEMBERSHIPS_TABLE,
        IndexName: 'byUser',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {':userId': userId},
    }));

    const channels = await Promise.all((memberships.Items ?? []).map(async ({channel}) => {
        const members = await ddb.send(new QueryCommand({
            TableName: process.env.MEMBERSHIPS_TABLE,
            KeyConditionExpression: 'channel = :channel',
            ExpressionAttributeValues: {':channel': channel},
        }));
        return {
            id: channel,
            members: (members.Items ?? []).map(({userId, username, name}) => ({id: userId, username, name})),
        };
    }));
    return json(200, channels);
};
