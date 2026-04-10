'use strict';

const { handleClaim } = require('./dailyBounty');

/**
 * Map of Discord Application Command names → handler functions.
 *
 * To add a new command:
 *   1. Create handlers/<name>.js and export a handler function
 *   2. Add { 'command-name': handlerFn } here
 *
 * @type {Record<string, (interaction: object) => Promise<object>>}
 */
const COMMAND_HANDLERS = {
    'claim': handleClaim,
    // 'register': handleRegister,  // example of a future addition
};

module.exports = { COMMAND_HANDLERS };
