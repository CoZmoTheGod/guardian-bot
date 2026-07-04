'use strict';

const { Events } = require('discord.js');
const { ReactionRoleMessage, ReactionRoleMapping } = require('../database');
const { logger } = require('../logger');

module.exports = {
  name: Events.MessageReactionAdd,
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
      // Exclusive panels: remove other roles (and their reactions) first.
      if (panel.exclusive) {
        const others = await ReactionRoleMapping.findAll({ where: { messageId: message.id } });
        for (const other of others) {
          if (other.roleId === role.id) continue;
          if (member.roles.cache.has(other.roleId)) {
            // eslint-disable-next-line no-await-in-loop
            await member.roles.remove(other.roleId, 'Reaction role (exclusive swap)').catch(() => {});
            const otherReaction = message.reactions.cache.find((r) => (r.emoji.id || r.emoji.name) === other.emoji);
            // eslint-disable-next-line no-await-in-loop
            await otherReaction?.users.remove(user.id).catch(() => {});
          }
        }
      }
      await member.roles.add(role, 'Reaction role');
      logger.debug(`Added role ${role.name} to ${user.tag} via reaction.`);
    } catch (err) {
      logger.debug(`Reaction-role add failed: ${err.message}`);
    }
  },
};
