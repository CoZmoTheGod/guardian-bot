'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { getGuildSettings, updateGuildSettings, invalidateGuildSettings, GuildSettings } = require('../../database');
const { embeds, replyError } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('View and change core server settings.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('view').setDescription('View all current settings.'))
    .addSubcommand((s) =>
      s
        .setName('logchannel')
        .setDescription('Set (or clear) the channel used for bot logs.')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Log channel (leave empty to clear)').addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('djrole')
        .setDescription('Set (or clear) the DJ role required to control music.')
        .addRoleOption((o) => o.setName('role').setDescription('DJ role (leave empty to clear)'))
    )
    .addSubcommand((s) =>
      s
        .setName('backuprole')
        .setDescription('Set (or clear) the role allowed to run backup commands.')
        .addRoleOption((o) => o.setName('role').setDescription('Backup role (leave empty to clear)'))
    )
    .addSubcommand((s) =>
      s
        .setName('sponsorblock')
        .setDescription('Toggle SponsorBlock auto-skip for music.')
        .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('reset')
        .setDescription('Reset ALL settings for this server to defaults.')
        .addBooleanOption((o) => o.setName('confirm').setDescription('Confirm the reset').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'view') {
      const s = await getGuildSettings(guildId);
      return interaction.reply({
        embeds: [
          embeds.info('Server settings').addFields(
            { name: 'Log channel', value: s.logChannelId ? `<#${s.logChannelId}>` : '—', inline: true },
            { name: 'DJ role', value: s.djRoleId ? `<@&${s.djRoleId}>` : 'Everyone', inline: true },
            { name: 'Backup role', value: s.backupPermRoleId ? `<@&${s.backupPermRoleId}>` : 'Owner/Admin only', inline: true },
            { name: 'Default volume', value: `${s.musicDefaultVolume}%`, inline: true },
            { name: 'SponsorBlock', value: s.sponsorBlockEnabled ? '✅ On' : '❌ Off', inline: true },
            { name: 'React-role channel', value: s.reactRoleChannelId ? `<#${s.reactRoleChannelId}>` : '—', inline: true },
            { name: 'Verification', value: s.verificationEnabled ? `✅ ${s.captchaMode}` : '❌ Off', inline: true },
            { name: 'Raid detection', value: s.raidModeEnabled ? '✅ On' : '❌ Off', inline: true },
            { name: 'Welcome / Leave', value: `${s.welcomeEnabled ? '✅' : '❌'} / ${s.leaveEnabled ? '✅' : '❌'}`, inline: true }
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'logchannel') {
      const channel = interaction.options.getChannel('channel');
      await updateGuildSettings(guildId, { logChannelId: channel?.id ?? null });
      return interaction.reply({
        embeds: [embeds.success('Log channel updated', channel ? `Logs will go to ${channel}.` : 'Log channel cleared.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'djrole') {
      const role = interaction.options.getRole('role');
      await updateGuildSettings(guildId, { djRoleId: role?.id ?? null });
      return interaction.reply({
        embeds: [embeds.success('DJ role updated', role ? `Music control now requires ${role}.` : 'DJ role cleared — everyone can control music.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'backuprole') {
      const role = interaction.options.getRole('role');
      await updateGuildSettings(guildId, { backupPermRoleId: role?.id ?? null });
      return interaction.reply({
        embeds: [embeds.success('Backup role updated', role ? `${role} can now manage backups.` : 'Backup role cleared — owner/admins only.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'sponsorblock') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await updateGuildSettings(guildId, { sponsorBlockEnabled: enabled });
      return interaction.reply({
        embeds: [embeds.success('SponsorBlock updated', `Auto-skip is now **${enabled ? 'enabled' : 'disabled'}** for new tracks.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'reset') {
      if (!interaction.options.getBoolean('confirm', true)) {
        return replyError(interaction, 'Not confirmed', 'You must set `confirm` to True to reset settings.');
      }
      await GuildSettings.destroy({ where: { guildId } });
      invalidateGuildSettings(guildId);
      await getGuildSettings(guildId); // recreate defaults
      return interaction.reply({ embeds: [embeds.success('Settings reset', 'All settings were restored to defaults.')], flags: MessageFlags.Ephemeral });
    }

    return replyError(interaction, 'Unknown subcommand', 'That subcommand is not recognised.');
  },
};
