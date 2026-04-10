'use strict';

const { verify } = require('@noble/ed25519');
// @noble/ed25519 v2 は非同期 verify がデフォルト。
// Lambda handler は async なので await で呼び出す。
// 同期 verifySync を使う場合は etc.sha512Sync のセットアップが別途必要。

/**
 * Discord Interaction リクエストの署名を検証する
 * @param {string} rawBody   - リクエストの生ボディ (文字列)
 * @param {string} signature - X-Signature-Ed25519 ヘッダーの値
 * @param {string} timestamp - X-Signature-Timestamp ヘッダーの値
 * @param {string} publicKey - Discord Application Public Key (hex string)
 * @returns {Promise<boolean>}
 */
async function verifyDiscordSignature(rawBody, signature, timestamp, publicKey) {
    try {
        const message  = Buffer.from(timestamp + rawBody);
        const sigBytes = Buffer.from(signature, 'hex');
        const keyBytes = Buffer.from(publicKey, 'hex');
        return await verify(sigBytes, message, keyBytes);
    } catch {
        return false;
    }
}

module.exports = { verifyDiscordSignature };
