'use strict';

const { Events } = require('discord.js');
const { getGuildSettings } = require('../database');
const { logger } = require('../logger');

module.exports = {
  name: Events.GuildCreate,
  async execute(guild) {
    // Ensure a settings row exists so features can be configured immediately.
    await getGuildSettings(guild.id).catch(() => {});
    logger.info(`Joined guild "${guild.name}" (${guild.id}) — ${guild.memberCount} members.`);
  },
};
