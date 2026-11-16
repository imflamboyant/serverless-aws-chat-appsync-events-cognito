#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import {ChatAppsyncEventsCognitoStack} from '../lib/chat-appsync-events-cognito-stack';

const app = new cdk.App();
new ChatAppsyncEventsCognitoStack(app, 'ChatAppsyncEventsCognitoStack', {
    // deploy to the account and region of the current AWS CLI profile
    env: {account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION},
});
