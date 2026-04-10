'use strict';

const { verify } = require('@noble/ed25519');
// @noble/ed25519 v2 uses async verify by default.
// The Lambda handler is async, so we call it with await.
// To use synchronous verifySync, sha512Sync setup is required separately.

/**
 * Verifies the signature of a Discord Interaction request.
 * @param {string} rawBody   - Raw request body (string)
 * @param {string} signature - Value of the X-Signature-Ed25519 header
 * @param {string} timestamp - Value of the X-Signature-Timestamp header
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
