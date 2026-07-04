'use strict';

const { Events } = require('discord.js');
const { getGuildSettings } = require('../database');
const { sendGuildLog } = require('../logger');

/**
 * Ghost-ping detection: when a non-bot message that mentioned users/roles is
 * deleted, report it to the log channel. Mentions are available even without
 * the privileged MessageContent intent; message text is included when present.
 */
module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    try {
      if (!message.guild || message.partial) return;
      if (!message.author || message.author.bot) return;

      const settings = await getGuildSettings(message.guild.id);
      if (!settings.ghostPingPrevention) return;

      const users = message.mentions?.users?.filter((u) => !u.bot && u.id !== message.author.id);
      const roles = message.mentions?.roles;
      const hasUser = users && users.size > 0;
      const hasRole = roles && roles.size > 0;
      if (!hasUser && !hasRole) return;

      const mentionList = [
        ...(hasUser ? users.map((u) => `<@${u.id}>`) : []),
        ...(hasRole ? roles.map((r) => `<@&${r.id}>`) : []),
      ].join(' ');

      const fields = [
        { name: 'Author', value: `${message.author}`, inline: true },
        { name: 'Channel', value: `${message.channel}`, inline: true },
      ];
      if (message.content) {
        fields.push({ name: 'Content', value: message.content.slice(0, 1000) });
      }

      await sendGuildLog(message.guild, {
        level: 'warn',
        title: '👻 Ghost ping detected',
        description: `A deleted message mentioned ${mentionList}.`,
        fields,
      });
    } catch {
      /* never throw from an event */
    }
  },
};
