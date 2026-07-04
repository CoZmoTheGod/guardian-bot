'use strict';

/** Standalone helper to create/verify database tables without starting the bot. */
const db = require('../database');
const { logger } = require('../logger');

(async () => {
  try {
    await db.connect();
    logger.info('Database schema is up to date.');
    await db.sequelize.close();
    process.exit(0);
  } catch (err) {
    logger.error('Database sync failed:', err);
    process.exit(1);
  }
})();
