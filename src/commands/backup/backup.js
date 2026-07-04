'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle, MessageFlags } = require('discord.js');
const { Backup } = require('../../database');
const backupManager = require('../../modules/backup/BackupManager');
const { canManageBackups } = require('../../utils/permissions');
const { embeds, replyError, COLORS } = require('../../utils/embeds');
const { sendGuildLog, logger } = require('../../logger');

const MAX_BACKUPS = 25;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Snapshot and restore your server (roles, channels, overwrites, emoji).')
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Create a named snapshot of this server.')
        .addStringOption((o) => o.setName('name').setDescription('A name for this backup').setRequired(true).setMaxLength(64))
    )
    .addSubcommand((s) => s.setName('list').setDescription('List all backups for this server.'))
    .addSubcommand((s) =>
      s
        .setName('info')
        .setDescription('Show details about a backup.')
        .addStringOption((o) => o.setName('name').setDescription('Backup name').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('load')
        .setDescription('Restore a backup into THIS server.')
        .addStringOption((o) => o.setName('name').setDescription('Backup name').setRequired(true))
        .addBooleanOption((o) =>
          o.setName('clear').setDescription('Delete existing channels/roles/emoji first (DESTRUCTIVE)')
        )
    )
    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('Delete a saved backup.')
        .addStringOption((o) => o.setName('name').setDescription('Backup name').setRequired(true))
    ),

  async execute(interaction) {
    // All backup actions are restricted to the owner / Administrators / the
    // configured backup permission role.
    if (!(await canManageBackups(interaction.member))) {
      return replyError(
        interaction,
        'Not allowed',
        'Only the server owner, Administrators, or the configured backup role can use this.'
      );
    }

    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    // ---- create ---------------------------------------------------------
    if (sub === 'create') {
      const name = interaction.options.getString('name', true).trim();
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const existingCount = await Backup.count({ where: { guildId: guild.id } });
      const existing = await Backup.findOne({ where: { guildId: guild.id, name } });
      if (!existing && existingCount >= MAX_BACKUPS) {
        return interaction.editReply({
          embeds: [embeds.error('Limit reached', `You can store at most ${MAX_BACKUPS} backups. Delete one first.`)],
        });
      }

      let data;
      try {
        data = await backupManager.snapshot(guild);
      } catch (err) {
        logger.error('snapshot failed:', err);
        return interaction.editReply({ embeds: [embeds.error('Backup failed', err.message)] });
      }

      if (existing) await existing.update({ data, createdBy: interaction.user.id });
      else await Backup.create({ guildId: guild.id, name, createdBy: interaction.user.id, data });

      const counts = backupManager.describe(data);
      await sendGuildLog(guild, {
        level: 'info',
        title: '💾 Backup created',
        fields: [
          { name: 'Name', value: name, inline: true },
          { name: 'By', value: `${interaction.user}`, inline: true },
        ],
      });
      return interaction.editReply({
        embeds: [
          embeds.success(
            existing ? 'Backup updated' : 'Backup created',
            `**${name}** saved — ${counts.roles} roles, ${counts.categories} categories, ${counts.channels} channels, ${counts.emojis} emoji.`
          ),
        ],
      });
    }

    // ---- list -----------------------------------------------------------
    if (sub === 'list') {
      const rows = await Backup.findAll({ where: { guildId: guild.id }, order: [['createdAt', 'DESC']] });
      if (rows.length === 0) {
        return interaction.reply({ embeds: [embeds.info('Backups', 'No backups saved yet. Use `/backup create`.')], flags: MessageFlags.Ephemeral });
      }
      const lines = rows.map((r) => {
        const c = backupManager.describe(r.data);
        const when = `<t:${Math.floor(new Date(r.createdAt).getTime() / 1000)}:R>`;
        return `• **${r.name}** — ${c.channels} channels, ${c.roles} roles — ${when}`;
      });
      return interaction.reply({ embeds: [embeds.info(`Backups (${rows.length})`, lines.join('\n'))], flags: MessageFlags.Ephemeral });
    }

    // ---- info -----------------------------------------------------------
    if (sub === 'info') {
      const name = interaction.options.getString('name', true).trim();
      const row = await Backup.findOne({ where: { guildId: guild.id, name } });
      if (!row) return replyError(interaction, 'Not found', `No backup named **${name}**.`);
      const c = backupManager.describe(row.data);
      return interaction.reply({
        embeds: [
          embeds
            .plain(COLORS.info)
            .setTitle(`💾 Backup: ${name}`)
            .addFields(
              { name: 'Origin server', value: row.data.guildName || 'Unknown', inline: true },
              { name: 'Created', value: `<t:${Math.floor(new Date(row.createdAt).getTime() / 1000)}:F>`, inline: true },
              { name: 'Created by', value: row.createdBy ? `<@${row.createdBy}>` : 'Unknown', inline: true },
              { name: 'Roles', value: String(c.roles), inline: true },
              { name: 'Categories', value: String(c.categories), inline: true },
              { name: 'Channels', value: String(c.channels), inline: true },
              { name: 'Emoji', value: String(c.emojis), inline: true }
            ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ---- delete ---------------------------------------------------------
    if (sub === 'delete') {
      const name = interaction.options.getString('name', true).trim();
      const row = await Backup.findOne({ where: { guildId: guild.id, name } });
      if (!row) return replyError(interaction, 'Not found', `No backup named **${name}**.`);
      await row.destroy();
      return interaction.reply({ embeds: [embeds.success('Backup deleted', `Deleted backup **${name}**.`)], flags: MessageFlags.Ephemeral });
    }

    // ---- load (with confirmation) --------------------------------------
    if (sub === 'load') {
      const name = interaction.options.getString('name', true).trim();
      const clear = interaction.options.getBoolean('clear') ?? false;

      const row = await Backup.findOne({ where: { guildId: guild.id, name } });
      if (!row) return replyError(interaction, 'Not found', `No backup named **${name}**.`);

      const me = guild.members.me;
      if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return replyError(interaction, 'Missing permissions', 'I need **Manage Roles** and **Manage Channels** to restore.');
      }

      const warning = clear
        ? '⚠️ **This will DELETE all current channels, non-managed roles and emoji**, then recreate them from the backup.'
        : 'This will **add** the backed-up roles, channels and emoji to the current server (existing items are kept).';

      const rowBtns = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('backupconfirm').setLabel('Confirm restore').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('backupcancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
      );

      const prompt = await interaction.reply({
        embeds: [embeds.warn(`Restore backup "${name}"?`, `${warning}\n\nThis cannot be undone. Confirm within 60 seconds.`)],
        components: [rowBtns],
        flags: MessageFlags.Ephemeral,
        fetchReply: true,
      });

      const confirmation = await prompt
        .awaitMessageComponent({ filter: (i) => i.user.id === interaction.user.id, time: 60000 })
        .catch(() => null);

      if (!confirmation || confirmation.customId === 'backupcancel') {
        return interaction.editReply({ embeds: [embeds.info('Cancelled', 'Restore cancelled.')], components: [] });
      }

      await confirmation.update({ embeds: [embeds.info('Restoring…', 'Recreating the server structure. This can take a while.')], components: [] });

      let summary;
      try {
        summary = await backupManager.restore(guild, row.data, { clear });
      } catch (err) {
        logger.error('restore failed:', err);
        return interaction.editReply({ embeds: [embeds.error('Restore failed', err.message)] });
      }

      await sendGuildLog(guild, {
        level: 'warn',
        title: '♻️ Backup restored',
        fields: [
          { name: 'Backup', value: name, inline: true },
          { name: 'By', value: `${interaction.user}`, inline: true },
          { name: 'Cleared first', value: clear ? 'Yes' : 'No', inline: true },
        ],
      });

      const errorNote = summary.errors.length
        ? `\n\n⚠️ ${summary.errors.length} item(s) failed (missing permissions or hierarchy). First few:\n` +
          summary.errors.slice(0, 5).map((e) => `• ${e}`).join('\n')
        : '';

      return interaction.editReply({
        embeds: [
          embeds.success(
            'Restore complete',
            `Created **${summary.rolesCreated}** roles, **${summary.categoriesCreated}** categories, ` +
              `**${summary.channelsCreated}** channels and **${summary.emojisCreated}** emoji.${errorNote}`
          ),
        ],
        components: [],
      });
    }

    return replyError(interaction, 'Unknown subcommand', 'That subcommand is not recognised.');
  },
};
