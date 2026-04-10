'use strict';

const http  = require('http');
const https = require('https');

const MATCHSERVER_HOST      = process.env.MATCHSERVER_HOST;
const MATCHSERVER_PORT      = parseInt(process.env.MATCHSERVER_PORT || '6034', 10);
const MATCHSERVER_SECRET    = process.env.MATCHSERVER_SECRET;
const MATCHSERVER_USE_HTTPS = process.env.MATCHSERVER_USE_HTTPS === 'true';

/**
 * Generic function to call the MatchServer Admin HTTP API.
 *
 * @param {string} method  - "GET" | "POST"
 * @param {string} path    - "/api/bounty/claim"
 * @param {object|null} body - JSON-serializable object
 * @returns {Promise<{statusCode: number, data: object}>}
 */
function callMatchServer(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : '';
        const lib = MATCHSERVER_USE_HTTPS ? https : http;

        const options = {
            hostname: MATCHSERVER_HOST,
            port:     MATCHSERVER_PORT,
            path,
            method,
            headers: {
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'Authorization':  `Bearer ${MATCHSERVER_SECRET}`,
            },
            timeout: 8000,
        };

        const req = lib.request(options, (res) => {
            let raw = '';
            res.on('data', chunk => { raw += chunk; });
            res.on('end', () => {
                let data = {};
                try { data = JSON.parse(raw); } catch { /* ignore */ }
                resolve({ statusCode: res.statusCode, data });
            });
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`MatchServer request timed out: ${method} ${path}`));
        });
        req.on('error', reject);

        if (payload) req.write(payload);
        req.end();
    });
}

module.exports = { callMatchServer };
