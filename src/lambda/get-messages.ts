import {APIGatewayProxyEvent, APIGatewayProxyResult} from 'aws-lambda';
import {QueryCommand} from '@aws-sdk/lib-dynamodb';
import {callerId, ddb, isMember, json} from './shared';

const MESSAGES_LIMIT = 100;

// GET /channels/{channel}/messages: the latest messages, oldest first, members only
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const channel = event.pathParameters?.channel;
    if (!channel || !(await isMember(channel, callerId(event)))) {
        return json(403, {message: 'Forbidden'});
    }
    const result = await ddb.send(new QueryCommand({
        TableName: process.env.MESSAGES_TABLE,
        KeyConditionExpression: 'channel = :channel',
        ExpressionAttributeValues: {':channel': channel},
        ScanIndexForward: false, // newest first, to get the latest page
        Limit: MESSAGES_LIMIT,
    }));
    return json(200, (result.Items ?? []).reverse());
};
