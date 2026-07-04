'use strict';

const { Events } = require('discord.js');
const { ReactionRoleMessage, ReactionRoleMapping } = require('../database');
const { logger } = require('../logger');

module.exports = {
  name: Events.MessageReactionRemove,
  async execute(reaction, user) {
    if (user.bot) return;
    try {
      if (reaction.partial) await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();
    } catch {
      return;
    }

    const message = reaction.message;
    if (!message.guild) return;

    const panel = await ReactionRoleMessage.findOne({ where: { messageId: message.id } });
    if (!panel) return;

    const key = reaction.emoji.id || reaction.emoji.name;
    const mapping = await ReactionRoleMapping.findOne({ where: { messageId: message.id, emoji: key } });
    if (!mapping) return;

    const member = await message.guild.members.fetch(user.id).catch(() => null);
    const role = message.guild.roles.cache.get(mapping.roleId);
    if (!member || !role) return;

    try {
      await member.roles.remove(role, 'Reaction role removed');
      logger.debug(`Removed role ${role.name} from ${user.tag} via reaction.`);
    } catch (err) {
      logger.debug(`Reaction-role remove failed: ${err.message}`);
    }
  },
};
