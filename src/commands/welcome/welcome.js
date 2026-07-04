'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { getGuildSettings, updateGuildSettings } = require('../../database');
const { embeds, replyError } = require('../../utils/embeds');
const { applyPlaceholders } = require('../../utils/time');

// Kept short so option descriptions stay within Discord's 100-char limit.
const PLACEHOLDERS = 'Supports {user} {user.tag} {user.name} {server} {memberCount}';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Configure join/leave messages and welcome DMs.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('join')
        .setDescription('Set and enable the join message.')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel for join messages').addChannelTypes(ChannelType.GuildText).setRequired(true)
        )
        .addStringOption((o) => o.setName('message').setDescription(`Message text. ${PLACEHOLDERS}`).setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('leave')
        .setDescription('Set and enable the leave message.')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel for leave messages').addChannelTypes(ChannelType.GuildText).setRequired(true)
        )
        .addStringOption((o) => o.setName('message').setDescription(`Message text. ${PLACEHOLDERS}`).setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('dm')
        .setDescription('Set and enable a welcome DM to new members.')
        .addStringOption((o) => o.setName('message').setDescription(`DM text. ${PLACEHOLDERS}`).setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('toggle')
        .setDescription('Enable or disable a welcome feature.')
        .addStringOption((o) =>
          o
            .setName('feature')
            .setDescription('Which feature')
            .setRequired(true)
            .addChoices(
              { name: 'Join message', value: 'join' },
              { name: 'Leave message', value: 'leave' },
              { name: 'Welcome DM', value: 'dm' },
              { name: 'Ghost-ping detection', value: 'ghostping' }
            )
        )
        .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('test')
        .setDescription('Preview the join or leave message.')
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Which message to test')
            .setRequired(true)
            .addChoices({ name: 'Join', value: 'join' }, { name: 'Leave', value: 'leave' })
        )
    )
    .addSubcommand((s) => s.setName('status').setDescription('Show the current welcome configuration.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const guildId = guild.id;

    if (sub === 'join') {
      const channel = interaction.options.getChannel('channel', true);
      const message = interaction.options.getString('message', true);
      await updateGuildSettings(guildId, { welcomeEnabled: true, welcomeChannelId: channel.id, welcomeMessage: message });
      return interaction.reply({
        embeds: [embeds.success('Join message set', `New members will be greeted in ${channel}.`)],
        ephemeral: true,
      });
    }

    if (sub === 'leave') {
      const channel = interaction.options.getChannel('channel', true);
      const message = interaction.options.getString('message', true);
      await updateGuildSettings(guildId, { leaveEnabled: true, leaveChannelId: channel.id, leaveMessage: message });
      return interaction.reply({
        embeds: [embeds.success('Leave message set', `Departures will be announced in ${channel}.`)],
        ephemeral: true,
      });
    }

    if (sub === 'dm') {
      const message = interaction.options.getString('message', true);
      await updateGuildSettings(guildId, { welcomeDmEnabled: true, welcomeDmMessage: message });
      return interaction.reply({
        embeds: [embeds.success('Welcome DM set', 'New members will receive this DM when they join.')],
        ephemeral: true,
      });
    }

    if (sub === 'toggle') {
      const feature = interaction.options.getString('feature', true);
      const enabled = interaction.options.getBoolean('enabled', true);
      const field = {
        join: 'welcomeEnabled',
        leave: 'leaveEnabled',
        dm: 'welcomeDmEnabled',
        ghostping: 'ghostPingPrevention',
      }[feature];
      await updateGuildSettings(guildId, { [field]: enabled });
      return interaction.reply({
        embeds: [embeds.success('Updated', `**${feature}** is now **${enabled ? 'enabled' : 'disabled'}**.`)],
        ephemeral: true,
      });
    }

    if (sub === 'test') {
      const type = interaction.options.getString('type', true);
      const s = await getGuildSettings(guildId);
      const channelId = type === 'join' ? s.welcomeChannelId : s.leaveChannelId;
      const template = type === 'join' ? s.welcomeMessage : s.leaveMessage;
      const channel = channelId && guild.channels.cache.get(channelId);
      if (!channel) {
        return replyError(interaction, 'Not configured', `No ${type} channel is set. Use \`/welcome ${type}\` first.`);
      }
      const content = applyPlaceholders(template, { member: interaction.member, guild });
      await channel.send({ content, allowedMentions: { parse: [] } }).catch(() => {});
      return interaction.reply({ embeds: [embeds.success('Test sent', `Sent a preview ${type} message to ${channel}.`)], ephemeral: true });
    }

    if (sub === 'status') {
      const s = await getGuildSettings(guildId);
      return interaction.reply({
        embeds: [
          embeds.info('Welcome configuration').addFields(
            { name: 'Join message', value: s.welcomeEnabled ? `✅ ${s.welcomeChannelId ? `<#${s.welcomeChannelId}>` : '—'}` : '❌ Off', inline: true },
            { name: 'Leave message', value: s.leaveEnabled ? `✅ ${s.leaveChannelId ? `<#${s.leaveChannelId}>` : '—'}` : '❌ Off', inline: true },
            { name: 'Welcome DM', value: s.welcomeDmEnabled ? '✅ On' : '❌ Off', inline: true },
            { name: 'Ghost-ping detection', value: s.ghostPingPrevention ? '✅ On' : '❌ Off', inline: true }
          ),
        ],
        ephemeral: true,
      });
    }

    return replyError(interaction, 'Unknown subcommand', 'That subcommand is not recognised.');
  },
};
