'use strict';

const { Events, ActivityType } = require('discord.js');
const { logger } = require('../logger');
const { registerCommands } = require('../register');
const verification = require('../modules/security/verification');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(`Logged in as ${client.user.tag} (${client.user.id}).`);
    logger.info(`Active in ${client.guilds.cache.size} guild(s).`);

    // Register slash commands (dev guild for instant updates, else global).
    try {
      await registerCommands({ clientId: client.user.id });
    } catch (err) {
      logger.error('Slash command registration failed:', err.message);
    }

    client.user.setPresence({
      status: 'online',
      activities: [{ name: 'over your server 🛡️', type: ActivityType.Watching }],
    });

    // Enforce/reschedule any verifications that were pending before restart.
    await verification.resumePending(client).catch((e) => logger.error('resumePending failed:', e));
    verification.startSweeper(client);

    // IMPORTANT: this exact line is what the Pterodactyl/Pelican egg watches for
    // to mark the server as "running". Do not change the wording.
    // eslint-disable-next-line no-console
    console.log('Guardian bot is online');
  },
};
