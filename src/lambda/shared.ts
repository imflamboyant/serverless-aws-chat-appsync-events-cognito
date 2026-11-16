import {APIGatewayProxyEvent, APIGatewayProxyResult} from 'aws-lambda';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient, GetCommand} from '@aws-sdk/lib-dynamodb';

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// The Cognito authorizer has already verified the ID token, its claims are trusted here
export function callerId(event: APIGatewayProxyEvent): string {
    return event.requestContext.authorizer?.claims?.sub;
}

export async function isMember(channel: string, userId: string): Promise<boolean> {
    const result = await ddb.send(new GetCommand({
        TableName: process.env.MEMBERSHIPS_TABLE,
        Key: {channel, userId},
    }));
    return result.Item !== undefined;
}

export function json(statusCode: number, body: unknown): APIGatewayProxyResult {
    return {
        statusCode,
        body: JSON.stringify(body),
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': process.env.CLIENT_ORIGIN ?? '',
        },
    };
}
