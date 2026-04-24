/**
 * google-register.ts — AWS Lambda handler for POST /register/google
 *
 * Accepts a Google ID token, verifies it with Google's public keys,
 * then sends MC_MATCH_LOGIN_GOOGLE to the GunZ MatchServer. The
 * MatchServer auto-creates an account for first-time users and returns
 * a session token on success.
 *
 * Environment variables:
 *   MATCHSERVER_HOST     — MatchServer IP or hostname (required)
 *   MATCHSERVER_PORT     — MatchServer TCP port        (default: 6000)
 *   GOOGLE_CLIENT_ID     — OAuth 2.0 client ID issued by Google Console (required)
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { OAuth2Client } from 'google-auth-library';
import { loginWithGoogle } from './matchserver';
import { buildGoogleAccountKey, getClientIp, recordRegisteredAccount } from './audit';

type GoogleClaims = {
    sub: string;
    email: string;
    name: string;
};

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function response(statusCode: number, body: object): APIGatewayProxyResultV2 {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
        },
        body: JSON.stringify(body),
    };
}

// ---------------------------------------------------------------------------
// Google token verification
// ---------------------------------------------------------------------------

/**
 * Verify a Google ID token and return the decoded claims.
 * Throws if the token is invalid or the audience does not match.
 */
async function verifyGoogleToken(idToken: string, clientId: string): Promise<GoogleClaims> {
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({
        idToken,
        audience: clientId,
    });

    const payload = ticket.getPayload();
    if (!payload) throw new Error('Empty Google token payload');

    const sub   = payload['sub'];
    const email = payload['email'] ?? '';
    const name  = payload['name'] ?? payload['email'] ?? sub;

    return { sub, email, name };
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    // Handle CORS preflight
    if (event.requestContext?.http?.method === 'OPTIONS') {
        return { statusCode: 204, headers: CORS_HEADERS, body: '' };
    }

    // Parse body
    let body: Record<string, unknown>;
    try {
        body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
    } catch {
        return response(400, { success: false, message: 'Invalid JSON body' });
    }

    const { idToken } = body;

    // DEBUG: log what idToken was received in the Lambda event body
    console.log('[google-register handler] typeof idToken:', typeof idToken);
    console.log('[google-register handler] idToken length:', typeof idToken === 'string' ? (idToken as string).length : 'N/A');
    console.log('[google-register handler] idToken (first 80 chars):', typeof idToken === 'string' ? (idToken as string).substring(0, 80) : idToken);

    if (typeof idToken !== 'string' || idToken.trim() === '') {
        return response(400, { success: false, message: 'idToken must be a non-empty string' });
    }

    // Read config from environment
    const host     = process.env.MATCHSERVER_HOST;
    const port     = parseInt(process.env.MATCHSERVER_PORT ?? '6000', 10);
    const clientId = process.env.GOOGLE_CLIENT_ID;

    if (!host) {
        return response(500, {
            success: false,
            message: 'Server configuration error: MATCHSERVER_HOST is not set',
        });
    }

    if (!clientId) {
        return response(500, {
            success: false,
            message: 'Server configuration error: GOOGLE_CLIENT_ID is not set',
        });
    }

    // Verify the Google ID token before touching the MatchServer
    let claims: GoogleClaims | undefined;
    try {
        claims = await verifyGoogleToken(idToken, clientId);
    } catch (err) {
        console.warn('Google token verification failed:', err);
        return response(401, {
            success: false,
            message: 'Invalid or expired Google ID token',
        });
    }

    if (!claims) {
        return response(500, {
            success: false,
            message: 'Server configuration error.',
        });
    }

    // DEBUG: log what is being passed to loginWithGoogle
    console.log('[google-register handler] passing idToken to loginWithGoogle, length:', idToken.length);

    // Send MC_MATCH_LOGIN_GOOGLE to the MatchServer
    try {
        const result = await loginWithGoogle(host, port, idToken);

        if (result.success) {
            try {
                const accountKey = buildGoogleAccountKey(claims.sub);
                await recordRegisteredAccount({
                    accountKey,
                    username: accountKey,
                    authProvider: 'google',
                    email: claims.email,
                    sourceIp: getClientIp(event) ?? 'unknown',
                    userAgent: event.headers?.['user-agent'] ?? event.headers?.['User-Agent'] ?? null,
                    requestId: event.requestContext.requestId,
                    route: event.requestContext.http.path,
                    stage: event.requestContext.stage ?? null,
                    matchserverMessage: result.message,
                });
            } catch (auditError) {
                console.error('registration audit log error:', auditError);
            }
            return response(200, {
                success: true,
                message: result.message,
                sessionToken: result.sessionToken,
                expiresAt: result.expiresAt,
            });
        } else {
            return response(400, { success: false, message: result.message });
        }
    } catch (err) {
        console.error('loginWithGoogle error:', err);
        return response(500, {
            success: false,
            message: 'Failed to contact the game server. Please try again later.',
        });
    }
};
