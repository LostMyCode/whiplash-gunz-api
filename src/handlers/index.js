'use strict';

const { handleClaim } = require('./dailyBounty');

/**
 * Discord Application Command 名 → ハンドラー関数のマップ
 *
 * 新しいコマンドを追加する場合:
 *   1. handlers/<name>.js を作成して handler 関数をエクスポート
 *   2. ここに { 'command-name': handlerFn } を追加するだけ
 *
 * @type {Record<string, (interaction: object) => Promise<object>>}
 */
const COMMAND_HANDLERS = {
    'claim': handleClaim,
    // 'register': handleRegister,  // 将来追加する例
};

module.exports = { COMMAND_HANDLERS };
