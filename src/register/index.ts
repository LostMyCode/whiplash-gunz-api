/**
 * index.ts — AWS Lambda handler for POST /register
 *
 * Validates the request body, hashes the password, and calls the GunZ
 * MatchServer to create a new account.
 *
 * Environment variables:
 *   MATCHSERVER_HOST  — MatchServer IP or hostname (required)
 *   MATCHSERVER_PORT  — MatchServer TCP port        (default: 6000)
 *   TURNSTILE_SECRET_KEY — Cloudflare Turnstile secret key (required)
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createAccount } from './matchserver';

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const USERNAME_RE = /^[a-zA-Z0-9]{4,}$/;
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate username: 5+ alphanumeric characters.
 */
function validateUsername(username: unknown): string | null {
    if (typeof username !== 'string') return 'Username must be a string';
    if (!USERNAME_RE.test(username))  return 'Username must be at least 4 alphanumeric characters';
    return null;
}

/**
 * Validate password: 4+ chars.
 */
function validatePassword(password: unknown): string | null {
    if (typeof password !== 'string') return 'Password must be a string';
    if (password.length < 4)          return 'Password must be at least 4 characters';
    return null;
}

/**
 * Validate e-mail address (basic check).
 */
function validateEmail(email: unknown): string | null {
    if (typeof email !== 'string') return 'Email must be a string';
    if (!EMAIL_RE.test(email))     return 'Invalid email address';
    return null;
}

async function verifyTurnstile(turnstileToken: string): Promise<boolean> {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) {
        throw new Error('TURNSTILE_SECRET_KEY is not set');
    }

    const form = new URLSearchParams();
    form.set('secret', secret);
    form.set('response', turnstileToken);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
    });

    if (!res.ok) {
        return false;
    }

    const data = await res.json() as { success?: boolean };
    return data.success === true;
}

// ---------------------------------------------------------------------------
// CORS headers for browser access
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
// Lambda handler
// ---------------------------------------------------------------------------

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    // Handle CORS preflight
    if (event.requestContext?.http?.method === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: CORS_HEADERS,
            body: '',
        };
    }

    // Parse body — API Gateway HTTP API passes JSON body as a string
    let body: Record<string, unknown>;
    try {
        body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
    } catch {
        return response(400, { success: false, message: 'Invalid JSON body' });
    }

    const { username, password, email, turnstileToken } = body;

    // Validate inputs
    const usernameError = validateUsername(username);
    if (usernameError) return response(400, { success: false, message: usernameError });

    const passwordError = validatePassword(password);
    if (passwordError) return response(400, { success: false, message: passwordError });

    const emailError = validateEmail(email);
    if (emailError) return response(400, { success: false, message: emailError });

    if (typeof turnstileToken !== 'string' || turnstileToken.trim() === '') {
        return response(400, {
            success: false,
            message: 'CAPTCHA verification failed. Please try again.',
        });
    }

    try {
        const verified = await verifyTurnstile(turnstileToken);
        if (!verified) {
            return response(400, {
                success: false,
                message: 'CAPTCHA verification failed. Please try again.',
            });
        }
    } catch (err) {
        console.error('Turnstile verification error:', err);
        return response(500, {
            success: false,
            message: 'Server configuration error.',
        });
    }

    // Read MatchServer connection config from environment
    const host = process.env.MATCHSERVER_HOST;
    const port = parseInt(process.env.MATCHSERVER_PORT ?? '6000', 10);

    if (!host) {
        return response(500, {
            success: false,
            message: 'Server configuration error: MATCHSERVER_HOST is not set',
        });
    }

    // Attempt account creation
    try {
        const result = await createAccount(host, port, username as string, password as string, email as string, process.env.REGISTRATION_SECRET ?? '');

        if (result.success) {
            return response(200, { success: true, message: result.message });
        } else {
            // The MatchServer returned a failure message (e.g. duplicate username)
            return response(400, { success: false, message: result.message });
        }
    } catch (err) {
        console.error('createAccount error:', err);
        return response(500, {
            success: false,
            message: 'Failed to contact the game server. Please try again later.',
        });
    }
};
