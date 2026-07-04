'use strict';

const { Events } = require('discord.js');
const { getGuildSettings, PendingVerification } = require('../database');
const { applyPlaceholders } = require('../utils/time');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    const guild = member.guild;
    const settings = await getGuildSettings(guild.id);

    // Clean up any pending verification so timers don't act on a gone member.
    await PendingVerification.destroy({ where: { guildId: guild.id, userId: member.id } }).catch(() => {});

    if (settings.leaveEnabled && settings.leaveChannelId) {
      const channel =
        guild.channels.cache.get(settings.leaveChannelId) ||
        (await guild.channels.fetch(settings.leaveChannelId).catch(() => null));
      if (channel?.isTextBased?.()) {
        const content = applyPlaceholders(settings.leaveMessage, { member, guild });
        // Never ping on leave (the user is gone; avoids ghost pings).
        channel.send({ content, allowedMentions: { parse: [] } }).catch(() => {});
      }
    }
  },
};
