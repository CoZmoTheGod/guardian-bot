'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const { ChannelLock } = require('../../database');
const { embeds, replyError } = require('../../utils/embeds');
const { sendGuildLog, logger } = require('../../logger');

const LOCKABLE = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
  ChannelType.GuildForum,
  ChannelType.GuildStageVoice,
];

// Restore map: what SendMessages value corresponds to each saved state.
const RESTORE = { allow: true, deny: false, neutral: null };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Unlock a previously locked channel, restoring its prior permission state.')
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Channel to unlock (defaults to this channel)').addChannelTypes(...LOCKABLE)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') || interaction.channel;

    const me = interaction.guild.members.me;
    if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) {
      return replyError(
        interaction,
        'Missing permissions',
        'I need the **Manage Channels** permission in that channel to unlock it.'
      );
    }

    const everyone = interaction.guild.roles.everyone;
    const record = await ChannelLock.findByPk(channel.id);

    // If we have no record, fall back to clearing the deny (neutral).
    const previous = record?.previous ?? 'neutral';
    const restoreValue = RESTORE[previous];

    try {
      await channel.permissionOverwrites.edit(
        everyone,
        { SendMessages: restoreValue },
        { reason: `Unlocked by ${interaction.user.tag}` }
      );
      if (record) await record.destroy();
    } catch (err) {
      logger.error('unlock failed:', err);
      return replyError(interaction, 'Failed to unlock', 'I could not update the channel permissions.');
    }

    await sendGuildLog(interaction.guild, {
      level: 'success',
      title: '🔓 Channel unlocked',
      fields: [
        { name: 'Channel', value: `${channel}`, inline: true },
        { name: 'Moderator', value: `${interaction.user}`, inline: true },
      ],
    });

    return interaction.reply({
      embeds: [embeds.success('Channel unlocked', `${channel} has been unlocked and its previous state restored.`)],
    });
  },
};
