'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { getGuildSettings, updateGuildSettings } = require('../../database');
const { embeds, replyError } = require('../../utils/embeds');
const captcha = require('../../modules/security/captcha');
const { clearRaid } = require('../../modules/security/raid');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('security')
    .setDescription('Configure anti-bot verification and raid protection.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommandGroup((g) =>
      g
        .setName('verification')
        .setDescription('Captcha verification on join.')
        .addSubcommand((s) =>
          s
            .setName('setup')
            .setDescription('Enable and configure verification.')
            .addRoleOption((o) => o.setName('verified_role').setDescription('Role granted after passing').setRequired(true))
            .addChannelOption((o) =>
              o
                .setName('channel')
                .setDescription('Channel where challenges are posted')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
            )
            .addStringOption((o) =>
              o
                .setName('mode')
                .setDescription('Captcha type (default: button)')
                .addChoices(
                  { name: "Button ('I'm human')", value: 'button' },
                  { name: 'Text code', value: 'text' },
                  { name: 'Image code', value: 'image' }
                )
            )
            .addStringOption((o) =>
              o
                .setName('delivery')
                .setDescription('Where to send the challenge (default: channel)')
                .addChoices({ name: 'Verification channel', value: 'channel' }, { name: 'Direct message', value: 'dm' })
            )
            .addIntegerOption((o) =>
              o.setName('timeout').setDescription('Seconds to respond before action (default 300)').setMinValue(30).setMaxValue(3600)
            )
            .addStringOption((o) =>
              o
                .setName('action')
                .setDescription('What to do on timeout/fail (default: kick)')
                .addChoices({ name: 'Kick', value: 'kick' }, { name: 'Flag (log only)', value: 'flag' })
            )
        )
        .addSubcommand((s) => s.setName('disable').setDescription('Disable verification.'))
        .addSubcommand((s) => s.setName('status').setDescription('Show verification configuration.'))
        .addSubcommand((s) =>
          s.setName('test').setDescription('Preview the captcha on yourself (safe — no role changes).')
        )
    )
    .addSubcommandGroup((g) =>
      g
        .setName('raid')
        .setDescription('Mass-join raid detection.')
        .addSubcommand((s) =>
          s
            .setName('config')
            .setDescription('Enable/configure raid detection.')
            .addBooleanOption((o) => o.setName('enabled').setDescription('Turn raid detection on/off').setRequired(true))
            .addIntegerOption((o) =>
              o.setName('threshold').setDescription('Joins that trigger a raid (default 8)').setMinValue(3).setMaxValue(100)
            )
            .addIntegerOption((o) =>
              o.setName('window').setDescription('Time window in seconds (default 10)').setMinValue(3).setMaxValue(300)
            )
            .addStringOption((o) =>
              o
                .setName('action')
                .setDescription('Action on raid (default alert)')
                .addChoices(
                  { name: 'Alert only', value: 'alert' },
                  { name: 'Kick new joiners', value: 'kick' },
                  { name: 'Lockdown (force verification)', value: 'lockdown' }
                )
            )
        )
        .addSubcommand((s) => s.setName('status').setDescription('Show raid detection configuration.'))
        .addSubcommand((s) => s.setName('reset').setDescription('Clear the current raid counter/state.'))
    ),

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup();
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    // ---- verification ---------------------------------------------------
    if (group === 'verification') {
      if (sub === 'setup') {
        const role = interaction.options.getRole('verified_role', true);
        const channel = interaction.options.getChannel('channel', true);
        const mode = interaction.options.getString('mode') || 'button';
        const delivery = interaction.options.getString('delivery') || 'channel';
        const timeout = interaction.options.getInteger('timeout') || 300;
        const action = interaction.options.getString('action') || 'kick';

        const me = interaction.guild.members.me;
        if (role.managed || role.position >= me.roles.highest.position) {
          return replyError(interaction, 'Role too high', `I cannot assign **${role.name}** — move my role above it.`);
        }
        if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
          return replyError(interaction, 'Missing permissions', 'I need the **Manage Roles** permission.');
        }
        if (action === 'kick' && !me.permissions.has(PermissionFlagsBits.KickMembers)) {
          return replyError(interaction, 'Missing permissions', 'Kick action requires the **Kick Members** permission.');
        }

        await updateGuildSettings(guildId, {
          verificationEnabled: true,
          verifiedRoleId: role.id,
          verificationChannelId: channel.id,
          captchaMode: mode,
          captchaDelivery: delivery,
          verifyTimeoutSec: timeout,
          unverifiedAction: action,
        });

        let note = '';
        if (mode === 'image' && !captcha.hasCanvas) {
          note = '\n\n⚠️ Image rendering is unavailable on this host — it will fall back to **text** codes.';
        }

        return interaction.reply({
          embeds: [
            embeds.success(
              'Verification enabled',
              `New members must pass a **${mode}** captcha (delivered via **${delivery}**).\n` +
                `Verified role: ${role}\nChannel: ${channel}\nTimeout: **${timeout}s** → action: **${action}**.${note}`
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (sub === 'disable') {
        await updateGuildSettings(guildId, { verificationEnabled: false });
        return interaction.reply({ embeds: [embeds.success('Verification disabled', 'New members will no longer be challenged.')], flags: MessageFlags.Ephemeral });
      }

      if (sub === 'status') {
        const s = await getGuildSettings(guildId);
        return interaction.reply({
          embeds: [
            embeds.info('Verification status').addFields(
              { name: 'Enabled', value: s.verificationEnabled ? '✅ Yes' : '❌ No', inline: true },
              { name: 'Mode', value: s.captchaMode, inline: true },
              { name: 'Delivery', value: s.captchaDelivery, inline: true },
              { name: 'Verified role', value: s.verifiedRoleId ? `<@&${s.verifiedRoleId}>` : '—', inline: true },
              { name: 'Channel', value: s.verificationChannelId ? `<#${s.verificationChannelId}>` : '—', inline: true },
              { name: 'Timeout', value: `${s.verifyTimeoutSec}s`, inline: true },
              { name: 'On fail', value: s.unverifiedAction, inline: true }
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (sub === 'test') {
        const s = await getGuildSettings(guildId);
        const mode = s.captchaMode || 'button';
        const code = mode === 'button' ? null : captcha.generateCode();
        const challenge = captcha.buildChallenge({
          mode,
          guildId,
          userId: interaction.user.id,
          code,
          guildName: interaction.guild.name,
          timeoutSec: s.verifyTimeoutSec,
          test: true,
        });
        return interaction.reply({
          embeds: challenge.embeds,
          components: challenge.components,
          files: challenge.files,
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    // ---- raid -----------------------------------------------------------
    if (group === 'raid') {
      if (sub === 'config') {
        const enabled = interaction.options.getBoolean('enabled', true);
        const values = { raidModeEnabled: enabled };
        const threshold = interaction.options.getInteger('threshold');
        const window = interaction.options.getInteger('window');
        const action = interaction.options.getString('action');
        if (threshold != null) values.raidJoinThreshold = threshold;
        if (window != null) values.raidWindowSec = window;
        if (action) values.raidAction = action;

        const s = await updateGuildSettings(guildId, values);
        return interaction.reply({
          embeds: [
            embeds.success(
              enabled ? 'Raid detection enabled' : 'Raid detection disabled',
              `Trigger: **${s.raidJoinThreshold}** joins within **${s.raidWindowSec}s** → action **${s.raidAction}**.`
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (sub === 'status') {
        const s = await getGuildSettings(guildId);
        return interaction.reply({
          embeds: [
            embeds.info('Raid detection status').addFields(
              { name: 'Enabled', value: s.raidModeEnabled ? '✅ Yes' : '❌ No', inline: true },
              { name: 'Threshold', value: `${s.raidJoinThreshold} joins`, inline: true },
              { name: 'Window', value: `${s.raidWindowSec}s`, inline: true },
              { name: 'Action', value: s.raidAction, inline: true }
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (sub === 'reset') {
        clearRaid(guildId);
        return interaction.reply({ embeds: [embeds.success('Raid state cleared', 'The join counter has been reset.')], flags: MessageFlags.Ephemeral });
      }
    }

    return replyError(interaction, 'Unknown subcommand', 'That subcommand is not recognised.');
  },
};
