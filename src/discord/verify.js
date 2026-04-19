'use strict';

const crypto = require('crypto');

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

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
        if (!signature || !timestamp || !publicKey) return false;

        const message = Buffer.from(timestamp + rawBody);
        const sigBytes = Buffer.from(signature, 'hex');
        const keyBytes = Buffer.from(publicKey, 'hex');

        if (sigBytes.length !== 64 || keyBytes.length !== 32) return false;

        const keyObject = crypto.createPublicKey({
            key: Buffer.concat([ED25519_SPKI_PREFIX, keyBytes]),
            format: 'der',
            type: 'spki',
        });

        return crypto.verify(null, message, keyObject, sigBytes);
    } catch {
        return false;
    }
}

module.exports = { verifyDiscordSignature };
