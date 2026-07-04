'use strict';

const { Events } = require('discord.js');
const { invalidateGuildSettings } = require('../database');
const { logger } = require('../logger');
const musicManager = require('../modules/music/MusicManager');

module.exports = {
  name: Events.GuildDelete,
  async execute(guild) {
    // Drop cached settings and stop any music player for this guild.
    invalidateGuildSettings(guild.id);
    const player = musicManager.get(guild);
    if (player) player.destroy();
    logger.info(`Removed from guild "${guild.name}" (${guild.id}).`);
  },
};
