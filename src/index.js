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
 * Lambda ハンドラー
 */
exports.handler = async (event) => {
    // API Gateway v2 (HTTP API) の場合はそのまま、v1 (REST API) も同様
    const signature = event.headers?.['x-signature-ed25519']
                   ?? event.headers?.['X-Signature-Ed25519'];
    const timestamp = event.headers?.['x-signature-timestamp']
                   ?? event.headers?.['X-Signature-Timestamp'];
    const rawBody   = event.body ?? '';

    // 1. 署名検証
    if (!DISCORD_PUBLIC_KEY) {
        console.error('DISCORD_PUBLIC_KEY not set');
        return { statusCode: 500, body: 'Server misconfiguration' };
    }

    const verified = await verifyDiscordSignature(rawBody, signature ?? '', timestamp ?? '', DISCORD_PUBLIC_KEY);
    if (!verified) {
        return { statusCode: 401, body: 'Invalid request signature' };
    }

    // 2. ボディ解析
    let interaction;
    try {
        interaction = JSON.parse(rawBody);
    } catch {
        return { statusCode: 400, body: 'Invalid JSON' };
    }

    // 3. Ping → Pong (Discord の疎通確認)
    if (interaction.type === InteractionType.PING) {
        return pong();
    }

    // 4. Application Command ルーティング
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
        const commandName = interaction.data?.name;
        const handler     = COMMAND_HANDLERS[commandName];

        if (!handler) {
            console.warn(`[router] Unknown command: ${commandName}`);
            return error(`未知のコマンドです: /${commandName}`);
        }

        try {
            return await handler(interaction);
        } catch (err) {
            console.error(`[router] Handler error for /${commandName}:`, err);
            return error('コマンドの処理中にエラーが発生しました。');
        }
    }

    // 5. 未対応の Interaction Type
    return { statusCode: 400, body: 'Unsupported interaction type' };
};
