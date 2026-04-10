'use strict';

// Discord Interaction Response Types
const InteractionResponseType = {
    PONG: 1,
    CHANNEL_MESSAGE_WITH_SOURCE: 4,
    DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
};

/**
 * Discord Ping response
 */
function pong() {
    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: InteractionResponseType.PONG }),
    };
}

/**
 * Reply with a text message.
 * @param {string} content
 * @param {object} options - { ephemeral: bool }
 */
function reply(content, options = {}) {
    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content,
                flags: options.ephemeral ? 64 : 0,
            },
        }),
    };
}

/**
 * Error response (user-facing)
 */
function error(message) {
    return reply(`❌ ${message}`, { ephemeral: true });
}

module.exports = { pong, reply, error };
