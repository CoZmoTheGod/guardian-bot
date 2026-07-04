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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Lock a channel so @everyone cannot send messages.')
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Channel to lock (defaults to this channel)').addChannelTypes(...LOCKABLE)
    )
    .addStringOption((o) => o.setName('reason').setDescription('Reason for locking'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (!LOCKABLE.includes(channel.type)) {
      return replyError(interaction, 'Unsupported channel', 'That channel type cannot be locked.');
    }

    const me = interaction.guild.members.me;
    if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) {
      return replyError(
        interaction,
        'Missing permissions',
        'I need the **Manage Channels** permission in that channel to lock it.'
      );
    }

    const everyone = interaction.guild.roles.everyone;
    const overwrite = channel.permissionOverwrites.cache.get(everyone.id);
    let previous = 'neutral';
    if (overwrite?.allow.has(PermissionFlagsBits.SendMessages)) previous = 'allow';
    else if (overwrite?.deny.has(PermissionFlagsBits.SendMessages)) previous = 'deny';

    if (previous === 'deny') {
      return replyError(interaction, 'Already locked', `${channel} is already locked for @everyone.`);
    }

    try {
      await channel.permissionOverwrites.edit(
        everyone,
        { SendMessages: false },
        { reason: `Locked by ${interaction.user.tag}: ${reason}` }
      );
      await ChannelLock.upsert({
        channelId: channel.id,
        guildId: interaction.guild.id,
        previous,
        lockedBy: interaction.user.id,
        reason,
      });
    } catch (err) {
      logger.error('lock failed:', err);
      return replyError(interaction, 'Failed to lock', 'I could not update the channel permissions.');
    }

    await sendGuildLog(interaction.guild, {
      level: 'warn',
      title: '🔒 Channel locked',
      fields: [
        { name: 'Channel', value: `${channel}`, inline: true },
        { name: 'Moderator', value: `${interaction.user}`, inline: true },
        { name: 'Reason', value: reason },
      ],
    });

    return interaction.reply({
      embeds: [embeds.success('Channel locked', `${channel} is now locked. Use \`/unlock\` to restore it.`)],
    });
  },
};
