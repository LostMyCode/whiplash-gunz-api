'use strict';

const { verifyDiscordSignature } = require('./discord/verify');
const { pong, error }            = require('./discord/respond');
const { COMMAND_HANDLERS }       = require('./handlers/index');

const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;

// Discord Interaction Types
const InteractionType = {
    PING:                             1,
    APPLICATION_COMMAND:              2,
    MESSAGE_COMPONENT:                3,
    APPLICATION_COMMAND_AUTOCOMPLETE: 4,
    MODAL_SUBMIT:                     5,
};

/**
 * Lambda handler
 */
exports.handler = async (event) => {
    // Works for both API Gateway v2 (HTTP API) and v1 (REST API)
    const signature = event.headers?.['x-signature-ed25519']
                   ?? event.headers?.['X-Signature-Ed25519'];
    const timestamp = event.headers?.['x-signature-timestamp']
                   ?? event.headers?.['X-Signature-Timestamp'];
    const rawBody   = event.body ?? '';

    // 1. Signature verification
    if (!DISCORD_PUBLIC_KEY) {
        console.error('DISCORD_PUBLIC_KEY not set');
        return { statusCode: 500, body: 'Server misconfiguration' };
    }

    const verified = await verifyDiscordSignature(rawBody, signature ?? '', timestamp ?? '', DISCORD_PUBLIC_KEY);
    if (!verified) {
        return { statusCode: 401, body: 'Invalid request signature' };
    }

    // 2. Parse body
    let interaction;
    try {
        interaction = JSON.parse(rawBody);
    } catch {
        return { statusCode: 400, body: 'Invalid JSON' };
    }

    // 3. Ping → Pong (Discord connectivity check)
    if (interaction.type === InteractionType.PING) {
        return pong();
    }

    // 4. Application Command routing
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
        const commandName = interaction.data?.name;
        const handler     = COMMAND_HANDLERS[commandName];

        if (!handler) {
            console.warn(`[router] Unknown command: ${commandName}`);
            return error(`Unknown command: /${commandName}`);
        }

        try {
            return await handler(interaction);
        } catch (err) {
            console.error(`[router] Handler error for /${commandName}:`, err);
            return error('An error occurred while processing the command.');
        }
    }

    // 5. Unsupported Interaction Type
    return { statusCode: 400, body: 'Unsupported interaction type' };
};
