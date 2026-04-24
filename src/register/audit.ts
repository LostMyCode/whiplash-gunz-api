import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'node:crypto';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export interface RegisteredAccountInput {
    accountKey: string;
    username: string;
    authProvider: 'password' | 'google';
    email: string;
    sourceIp: string;
    userAgent: string | null;
    requestId: string;
    route: string;
    stage: string | null;
    matchserverMessage: string;
}

export function buildGoogleAccountKey(sub: string): string {
    const digest = createHash('sha256').update(sub, 'utf8').digest();
    return `g_${digest.subarray(0, 16).toString('base64url')}`;
}

export function getClientIp(event: APIGatewayProxyEventV2): string | null {
    const sourceIp = event.requestContext?.http?.sourceIp?.trim();
    if (sourceIp) return sourceIp;

    const xForwardedFor = event.headers?.['x-forwarded-for'] ?? event.headers?.['X-Forwarded-For'];
    if (typeof xForwardedFor === 'string') {
        const firstIp = xForwardedFor.split(',')[0]?.trim();
        if (firstIp) return firstIp;
    }

    const xRealIp = event.headers?.['x-real-ip'] ?? event.headers?.['X-Real-Ip'];
    if (typeof xRealIp === 'string' && xRealIp.trim() !== '') {
        return xRealIp.trim();
    }

    return null;
}

export async function recordRegisteredAccount(input: RegisteredAccountInput): Promise<void> {
    const tableName = process.env.REGISTERED_ACCOUNTS_TABLE_NAME;
    if (!tableName) return;

    const now = new Date().toISOString();

    try {
        await dynamo.send(new PutCommand({
            TableName: tableName,
            Item: {
                accountKey: input.accountKey,
                username: input.username,
                authProvider: input.authProvider,
                route: input.route,
                stage: input.stage ?? 'unknown',
                requestId: input.requestId,
                email: input.email,
                sourceIp: input.sourceIp,
                userAgent: input.userAgent ?? 'unknown',
                createdAt: now,
                updatedAt: now,
                matchserverMessage: input.matchserverMessage,
            },
            ConditionExpression: 'attribute_not_exists(accountKey)',
        }));
    } catch (err) {
        if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
            return;
        }
        throw err;
    }
}
