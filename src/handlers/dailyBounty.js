'use strict';

const { callMatchServer } = require('../matchserver/client');
const { reply, error }    = require('../discord/respond');

/**
 * Handles the /claim <code> command.
 *
 * @param {object} interaction - Discord Interaction object
 * @returns {Promise<object>} - API Gateway response
 */
async function handleClaim(interaction) {
    const options = interaction.data?.options ?? [];
    const codeOpt = options.find(o => o.name === 'code');
    const code    = codeOpt?.value?.trim().toUpperCase() ?? '';

    if (!code || !/^OGZ-[0-9A-F]{6}$/.test(code)) {
        return error('Code has an invalid format. Example: `OGZ-A1B2C3`');
    }

    const discordUserId = interaction.member?.user?.id ?? interaction.user?.id ?? '';

    let result;
    try {
        result = await callMatchServer('POST', '/api/bounty/claim', {
            code,
            discord_user_id: discordUserId,
        });
    } catch (err) {
        console.error('[dailyBounty] MatchServer error:', err.message);
        return error('Failed to connect to the server. Please try again later.');
    }

    if (result.data?.ok) {
        const charName  = result.data.char_name  ?? 'unknown';
        const bpGranted = result.data.bp_granted ?? 0;
        return reply(`✅ **${bpGranted} BP** has been granted to **${charName}**!`);
    }

    const reasons = {
        'code invalid, expired, or already claimed':
            'Code is invalid, expired, or already used.',
    };
    const reason = reasons[result.data?.reason] ?? result.data?.reason ?? 'An error occurred.';
    return error(reason);
}

module.exports = { handleClaim };
