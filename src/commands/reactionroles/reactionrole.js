'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType, MessageFlags } = require('discord.js');
const { ReactionRoleMessage, ReactionRoleMapping, updateGuildSettings, getGuildSettings } = require('../../database');
const { embeds, replyError, COLORS } = require('../../utils/embeds');
const { logger } = require('../../logger');

/** Parse an emoji string into DB + reaction friendly parts. */
function parseEmoji(input) {
  const custom = input.trim().match(/^<(a)?:(\w+):(\d+)>$/);
  if (custom) {
    return { key: custom[3], name: custom[2], react: `${custom[2]}:${custom[3]}`, display: input.trim() };
  }
  const trimmed = input.trim();
  return { key: trimmed, name: trimmed, react: trimmed, display: trimmed };
}

/** Reaction string usable with message.react() from stored mapping values. */
function reactString(mapping) {
  return /^\d+$/.test(mapping.emoji) ? `${mapping.emojiName}:${mapping.emoji}` : mapping.emoji;
}

/** Rebuild a panel's embed to reflect its current mappings. */
async function renderPanel(panel, guild) {
  const mappings = await ReactionRoleMapping.findAll({ where: { messageId: panel.messageId } });
  const lines = mappings.map((m) => {
    const emoji = /^\d+$/.test(m.emoji) ? `<:${m.emojiName}:${m.emoji}>` : m.emoji;
    return `${emoji} → <@&${m.roleId}>`;
  });
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(panel.title || 'Reaction Roles')
    .setDescription(
      `${panel.description || ''}\n\n${lines.length ? lines.join('\n') : '_No roles configured yet._'}`.trim()
    )
    .setFooter({ text: panel.exclusive ? 'Pick one role at a time' : 'React to toggle a role' });
  return { embed, mappings };
}

async function fetchPanelMessage(guild, panel) {
  const channel = guild.channels.cache.get(panel.channelId) || (await guild.channels.fetch(panel.channelId).catch(() => null));
  if (!channel?.isTextBased?.()) return null;
  return channel.messages.fetch(panel.messageId).catch(() => null);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Manage self-assignable reaction-role panels.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((s) =>
      s
        .setName('setchannel')
        .setDescription('Designate the default channel for reaction-role panels.')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('The react-role channel').addChannelTypes(ChannelType.GuildText).setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Post a new reaction-role panel.')
        .addStringOption((o) => o.setName('title').setDescription('Panel title').setRequired(true))
        .addStringOption((o) => o.setName('description').setDescription('Panel description').setRequired(true))
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel to post in (defaults to the designated channel)').addChannelTypes(ChannelType.GuildText)
        )
        .addBooleanOption((o) => o.setName('exclusive').setDescription('Only allow one role from this panel at a time'))
    )
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add an emoji → role mapping to a panel.')
        .addStringOption((o) => o.setName('message_id').setDescription('The panel message ID').setRequired(true))
        .addStringOption((o) => o.setName('emoji').setDescription('Emoji to react with').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role to assign').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove an emoji mapping from a panel.')
        .addStringOption((o) => o.setName('message_id').setDescription('The panel message ID').setRequired(true))
        .addStringOption((o) => o.setName('emoji').setDescription('Emoji to remove').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('Delete a reaction-role panel entirely.')
        .addStringOption((o) => o.setName('message_id').setDescription('The panel message ID').setRequired(true))
    )
    .addSubcommand((s) => s.setName('list').setDescription('List all reaction-role panels in this server.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    // ---- setchannel -----------------------------------------------------
    if (sub === 'setchannel') {
      const channel = interaction.options.getChannel('channel', true);
      await updateGuildSettings(guild.id, { reactRoleChannelId: channel.id });
      return interaction.reply({
        embeds: [embeds.success('React-role channel set', `Panels will default to ${channel}.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ---- create ---------------------------------------------------------
    if (sub === 'create') {
      const title = interaction.options.getString('title', true);
      const description = interaction.options.getString('description', true);
      const exclusive = interaction.options.getBoolean('exclusive') ?? false;

      const settings = await getGuildSettings(guild.id);
      const target =
        interaction.options.getChannel('channel') ||
        (settings.reactRoleChannelId && guild.channels.cache.get(settings.reactRoleChannelId)) ||
        interaction.channel;

      if (!target?.isTextBased?.()) {
        return replyError(interaction, 'Invalid channel', 'Please choose a text channel for the panel.');
      }
      if (!target.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)) {
        return replyError(interaction, 'Missing permissions', `I cannot send messages in ${target}.`);
      }

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle(title)
        .setDescription(`${description}\n\n_No roles configured yet._`)
        .setFooter({ text: exclusive ? 'Pick one role at a time' : 'React to toggle a role' });

      const message = await target.send({ embeds: [embed] });
      await ReactionRoleMessage.create({
        guildId: guild.id,
        channelId: target.id,
        messageId: message.id,
        title,
        description,
        exclusive,
      });

      return interaction.reply({
        embeds: [
          embeds.success(
            'Panel created',
            `Posted in ${target}.\nAdd roles with:\n\`/reactionrole add message_id:${message.id} emoji:<emoji> role:@role\``
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ---- add ------------------------------------------------------------
    if (sub === 'add') {
      const messageId = interaction.options.getString('message_id', true);
      const emojiInput = interaction.options.getString('emoji', true);
      const role = interaction.options.getRole('role', true);

      const panel = await ReactionRoleMessage.findOne({ where: { guildId: guild.id, messageId } });
      if (!panel) return replyError(interaction, 'Unknown panel', 'No panel found with that message ID. Create one first.');

      // Role safety checks.
      const me = guild.members.me;
      if (role.managed || role.id === guild.id) {
        return replyError(interaction, 'Invalid role', 'That role cannot be self-assigned.');
      }
      if (role.position >= me.roles.highest.position) {
        return replyError(interaction, 'Role too high', `I cannot assign **${role.name}** — move my role above it.`);
      }
      if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return replyError(interaction, 'Missing permissions', 'I need the **Manage Roles** permission.');
      }

      const emoji = parseEmoji(emojiInput);
      const existingCount = await ReactionRoleMapping.count({ where: { messageId } });
      if (existingCount >= 20) {
        return replyError(interaction, 'Limit reached', 'A panel can have at most 20 reaction roles (Discord limit).');
      }
      const dup = await ReactionRoleMapping.findOne({ where: { messageId, emoji: emoji.key } });
      if (dup) return replyError(interaction, 'Duplicate emoji', 'That emoji is already used on this panel.');

      const message = await fetchPanelMessage(guild, panel);
      if (!message) return replyError(interaction, 'Message gone', 'The panel message no longer exists.');

      try {
        await message.react(emoji.react);
      } catch (err) {
        logger.debug(`react failed: ${err.message}`);
        return replyError(interaction, 'Bad emoji', 'I could not react with that emoji. Use a standard emoji or one from this server.');
      }

      await ReactionRoleMapping.create({
        guildId: guild.id,
        messageId,
        emoji: emoji.key,
        emojiName: emoji.name,
        roleId: role.id,
      });

      const { embed } = await renderPanel(panel, guild);
      await message.edit({ embeds: [embed] }).catch(() => {});

      return interaction.reply({
        embeds: [embeds.success('Mapping added', `${emoji.display} now grants ${role}.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ---- remove ---------------------------------------------------------
    if (sub === 'remove') {
      const messageId = interaction.options.getString('message_id', true);
      const emoji = parseEmoji(interaction.options.getString('emoji', true));

      const panel = await ReactionRoleMessage.findOne({ where: { guildId: guild.id, messageId } });
      if (!panel) return replyError(interaction, 'Unknown panel', 'No panel found with that message ID.');

      const mapping = await ReactionRoleMapping.findOne({ where: { messageId, emoji: emoji.key } });
      if (!mapping) return replyError(interaction, 'Not mapped', 'That emoji is not mapped on this panel.');

      await mapping.destroy();

      const message = await fetchPanelMessage(guild, panel);
      if (message) {
        const { embed } = await renderPanel(panel, guild);
        await message.edit({ embeds: [embed] }).catch(() => {});
        await message.reactions.cache.find((r) => (r.emoji.id || r.emoji.name) === emoji.key)?.remove().catch(() => {});
      }

      return interaction.reply({ embeds: [embeds.success('Mapping removed', 'The emoji mapping was removed.')], flags: MessageFlags.Ephemeral });
    }

    // ---- delete ---------------------------------------------------------
    if (sub === 'delete') {
      const messageId = interaction.options.getString('message_id', true);
      const panel = await ReactionRoleMessage.findOne({ where: { guildId: guild.id, messageId } });
      if (!panel) return replyError(interaction, 'Unknown panel', 'No panel found with that message ID.');

      await ReactionRoleMapping.destroy({ where: { messageId } });
      await panel.destroy();

      const message = await fetchPanelMessage(guild, panel);
      await message?.delete().catch(() => {});

      return interaction.reply({ embeds: [embeds.success('Panel deleted', 'The reaction-role panel was removed.')], flags: MessageFlags.Ephemeral });
    }

    // ---- list -----------------------------------------------------------
    if (sub === 'list') {
      const panels = await ReactionRoleMessage.findAll({ where: { guildId: guild.id } });
      if (panels.length === 0) {
        return interaction.reply({ embeds: [embeds.info('Reaction-role panels', 'No panels configured yet.')], flags: MessageFlags.Ephemeral });
      }
      const lines = [];
      for (const panel of panels) {
        const count = await ReactionRoleMapping.count({ where: { messageId: panel.messageId } });
        lines.push(`• **${panel.title || 'Panel'}** — <#${panel.channelId}> — \`${panel.messageId}\` (${count} role(s))`);
      }
      return interaction.reply({ embeds: [embeds.info('Reaction-role panels', lines.join('\n'))], flags: MessageFlags.Ephemeral });
    }

    return replyError(interaction, 'Unknown subcommand', 'That subcommand is not recognised.');
  },
};
