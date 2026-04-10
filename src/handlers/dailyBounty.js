'use strict';

const { callMatchServer } = require('../matchserver/client');
const { reply, error }    = require('../discord/respond');

/**
 * /claim <code> コマンドを処理する
 *
 * @param {object} interaction - Discord Interaction オブジェクト
 * @returns {Promise<object>} - API Gateway レスポンス
 */
async function handleClaim(interaction) {
    const options = interaction.data?.options ?? [];
    const codeOpt = options.find(o => o.name === 'code');
    const code    = codeOpt?.value?.trim().toUpperCase() ?? '';

    if (!code || !/^OGZ-[0-9A-F]{6}$/.test(code)) {
        return error('コードの形式が正しくありません。例: `OGZ-A1B2C3`');
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
        return error('サーバーへの接続に失敗しました。しばらくお待ちください。');
    }

    if (result.data?.ok) {
        const charName  = result.data.char_name  ?? '不明';
        const bpGranted = result.data.bp_granted ?? 0;
        return reply(`✅ **${charName}** に **${bpGranted} BP** が付与されました！`);
    }

    const reasons = {
        'code invalid, expired, or already claimed':
            'コードが無効・期限切れ、またはすでに使用済みです。',
    };
    const reason = reasons[result.data?.reason] ?? result.data?.reason ?? 'エラーが発生しました。';
    return error(reason);
}

module.exports = { handleClaim };
