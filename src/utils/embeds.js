'use strict';

const { EmbedBuilder, MessageFlags } = require('discord.js');

const COLORS = {
  primary: 0x5865f2,
  success: 0x57f287,
  error: 0xed4245,
  warn: 0xfee75c,
  info: 0x5865f2,
  music: 0x1db954,
};

const base = (color) => new EmbedBuilder().setColor(color).setTimestamp();

const embeds = {
  COLORS,
  success: (title, description) =>
    base(COLORS.success).setTitle(`✅ ${title}`).setDescription(description || null),
  error: (title, description) =>
    base(COLORS.error).setTitle(`❌ ${title}`).setDescription(description || null),
  warn: (title, description) =>
    base(COLORS.warn).setTitle(`⚠️ ${title}`).setDescription(description || null),
  info: (title, description) =>
    base(COLORS.info).setTitle(title).setDescription(description || null),
  plain: (color = COLORS.primary) => base(color),
};

/**
 * Reply to an interaction with an ephemeral error embed, transparently
 * handling whether the interaction was already deferred/replied.
 */
async function replyError(interaction, title, description) {
  const payload = { embeds: [embeds.error(title, description)], flags: MessageFlags.Ephemeral };
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch {
    /* interaction expired — nothing else we can do */
  }
}

module.exports = { embeds, replyError, COLORS };
