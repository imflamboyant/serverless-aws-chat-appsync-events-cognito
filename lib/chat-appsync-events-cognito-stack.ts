import * as cdk from 'aws-cdk-lib';
import {CfnOutput, RemovalPolicy} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import * as path from 'path';
import {AttributeType, BillingMode, Table} from 'aws-cdk-lib/aws-dynamodb';
import {NodejsFunction} from 'aws-cdk-lib/aws-lambda-nodejs';
import {Runtime} from 'aws-cdk-lib/aws-lambda';
import {
    AuthorizationType,
    CognitoUserPoolsAuthorizer,
    LambdaIntegration,
    ResponseType,
    RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import {
    AppSyncAuthorizationType,
    AppSyncDynamoDbDataSource,
    Code as AppSyncCode,
    EventApi,
} from 'aws-cdk-lib/aws-appsync';
import {
    CfnManagedLoginBranding,
    ManagedLoginVersion,
    OAuthScope,
    UserPool,
    UserPoolClientIdentityProvider,
} from 'aws-cdk-lib/aws-cognito';

// The client is served locally, see README.md
const CLIENT_ORIGIN = 'http://localhost:5173';

export class ChatAppsyncEventsCognitoStack extends cdk.Stack {

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Cognito user pool. No self sign-up: users are created by scripts/create-user.sh.
        const userPool = new UserPool(this, 'ChatUserPool', {
            userPoolName: 'serverless-chat-cognito',
            selfSignUpEnabled: false,
            signInAliases: {username: true},
            standardAttributes: {fullname: {required: false, mutable: true}},
            removalPolicy: RemovalPolicy.DESTROY, // do not use in production
        });
        const domain = userPool.addDomain('ChatUserPoolDomain', {
            cognitoDomain: {domainPrefix: `serverless-chat-${this.account}`},
            managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
        });
        // public client for the browser: authorization code grant with PKCE, no client secret
        const userPoolClient = userPool.addClient('ChatWebClient', {
            generateSecret: false,
            // the Cognito default, set explicitly: removing the property later doesn't reset it
            idTokenValidity: cdk.Duration.hours(1),
            // ADMIN_USER_PASSWORD_AUTH lets the AWS CLI sign in with your AWS credentials (README)
            authFlows: {adminUserPassword: true},
            oAuth: {
                flows: {authorizationCodeGrant: true},
                scopes: [OAuthScope.OPENID, OAuthScope.PROFILE],
                callbackUrls: [`${CLIENT_ORIGIN}/`],
                logoutUrls: [`${CLIENT_ORIGIN}/`],
            },
            supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
            preventUserExistenceErrors: true,
        });
        // managed login needs a style assigned to the app client, use the Cognito default
        new CfnManagedLoginBranding(this, 'ChatManagedLoginBranding', {
            userPoolId: userPool.userPoolId,
            clientId: userPoolClient.userPoolClientId,
            useCognitoProvidedValues: true,
        });

        // DynamoDB table for chat messages: one partition per channel, sorted by time
        const messagesTable = new Table(this, 'ChatMessagesTable', {
            tableName: 'serverless-chat-cognito-messages',
            partitionKey: {name: 'channel', type: AttributeType.STRING},
            sortKey: {name: 'id', type: AttributeType.STRING},
            billingMode: BillingMode.PAY_PER_REQUEST,
            removalPolicy: RemovalPolicy.DESTROY, // do not use in production
        });
        // DynamoDB table for channel membership: one item per (channel, Cognito sub)
        const membershipsTable = new Table(this, 'ChatMembershipsTable', {
            tableName: 'serverless-chat-cognito-memberships',
            partitionKey: {name: 'channel', type: AttributeType.STRING},
            sortKey: {name: 'userId', type: AttributeType.STRING},
            billingMode: BillingMode.PAY_PER_REQUEST,
            removalPolicy: RemovalPolicy.DESTROY, // do not use in production
        });
        // inverted index to list the channels of a user
        membershipsTable.addGlobalSecondaryIndex({
            indexName: 'byUser',
            partitionKey: {name: 'userId', type: AttributeType.STRING},
            sortKey: {name: 'channel', type: AttributeType.STRING},
        });

        // Lambda functions behind the REST API
        const lambdaEnvironment = {
            MESSAGES_TABLE: messagesTable.tableName,
            MEMBERSHIPS_TABLE: membershipsTable.tableName,
            CLIENT_ORIGIN,
        };
        const listChannelsLambda = new NodejsFunction(this, 'ListChannelsLambda', {
            runtime: Runtime.NODEJS_24_X,
            entry: path.join(__dirname, '../src/lambda/list-channels.ts'),
            environment: lambdaEnvironment,
        });
        membershipsTable.grantReadData(listChannelsLambda);

        const getMessagesLambda = new NodejsFunction(this, 'GetMessagesLambda', {
            runtime: Runtime.NODEJS_24_X,
            entry: path.join(__dirname, '../src/lambda/get-messages.ts'),
            environment: lambdaEnvironment,
        });
        membershipsTable.grantReadData(getMessagesLambda);
        messagesTable.grantReadData(getMessagesLambda);

        // REST API, every method requires a valid Cognito ID token
        const authorizer = new CognitoUserPoolsAuthorizer(this, 'ChatApiAuthorizer', {
            cognitoUserPools: [userPool],
        });
        const api = new RestApi(this, 'ServerlessChatApi', {
            restApiName: 'Serverless Chat Cognito API',
            defaultCorsPreflightOptions: {
                allowOrigins: [CLIENT_ORIGIN],
                allowMethods: ['GET'],
                allowHeaders: ['Authorization', 'Content-Type'],
            },
            defaultMethodOptions: {
                authorizer,
                authorizationType: AuthorizationType.COGNITO,
            },
        });
        // CORS headers on 401/403 from the authorizer, so the browser can read the status
        api.addGatewayResponse('Default4xx', {
            type: ResponseType.DEFAULT_4XX,
            responseHeaders: {'Access-Control-Allow-Origin': `'${CLIENT_ORIGIN}'`},
        });
        // GET /channels: the caller's channels with their members
        const channelsResource = api.root.addResource('channels');
        channelsResource.addMethod('GET', new LambdaIntegration(listChannelsLambda));
        // GET /channels/{channel}/messages: message history, members only
        channelsResource.addResource('{channel}').addResource('messages')
            .addMethod('GET', new LambdaIntegration(getMessagesLambda));

        // AppSync Event API, Cognito user pool for connect, publish and subscribe
        const eventApi = new EventApi(this, 'ChatAppSyncEventsApi', {
            apiName: 'ChatAppSyncEventApiCognito',
            authorizationConfig: {
                authProviders: [{
                    authorizationType: AppSyncAuthorizationType.USER_POOL,
                    cognitoConfig: {userPool},
                }],
                connectionAuthModeTypes: [AppSyncAuthorizationType.USER_POOL],
                defaultPublishAuthModeTypes: [AppSyncAuthorizationType.USER_POOL],
                defaultSubscribeAuthModeTypes: [AppSyncAuthorizationType.USER_POOL],
            },
        });
        // Both handlers use the memberships data source, read-only: the Event API can't change
        // membership. onPublish also writes to the messages table in the same transaction,
        // so the data source role needs write access to that table.
        const membershipsDataSource = new AppSyncDynamoDbDataSource(this, 'MembershipsDataSource', {
            api: eventApi,
            name: 'memberships',
            table: membershipsTable,
            readOnlyAccess: true,
        });
        messagesTable.grantWriteData(membershipsDataSource);
        eventApi.addChannelNamespace('serverlesschat', {
            code: AppSyncCode.fromAsset(path.join(__dirname, '../src/appsyncjs/serverlesschat-handler.js')),
            publishHandlerConfig: {dataSource: membershipsDataSource},
            subscribeHandlerConfig: {dataSource: membershipsDataSource},
        });

        // outputs, for client/config.js, scripts/create-user.sh and the commands in the README
        new CfnOutput(this, 'UserPoolId', {value: userPool.userPoolId});
        new CfnOutput(this, 'UserPoolClientId', {value: userPoolClient.userPoolClientId});
        new CfnOutput(this, 'CognitoDomainUrl', {value: domain.baseUrl()});
        new CfnOutput(this, 'RestApiUrl', {value: api.url});
        new CfnOutput(this, 'EventApiHttpDns', {value: eventApi.httpDns});
        new CfnOutput(this, 'EventApiRealtimeDns', {value: eventApi.realtimeDns});
        new CfnOutput(this, 'MembershipsTableName', {value: membershipsTable.tableName});
    }
}
