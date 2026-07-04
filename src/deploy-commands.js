'use strict';

/**
 * Standalone slash-command registration script.
 *
 *   npm run deploy           # dev guild if NODE_ENV=development + GUILD_ID set,
 *                            # otherwise global
 *   npm run deploy:global    # force global registration
 *
 * Useful when you want to (re)register commands without starting the bot.
 */

const { config } = require('./config');
const { logger } = require('./logger');
const { registerCommands } = require('./register');

const forceGlobal = process.argv.includes('--global');

registerCommands({ forceGlobal })
  .then((count) => {
    logger.info(`Done. ${count} command(s) registered (${forceGlobal ? 'global' : config.env}).`);
    process.exit(0);
  })
  .catch((err) => {
    logger.error('Command registration failed:', err);
    process.exit(1);
  });
