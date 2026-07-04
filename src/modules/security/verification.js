'use strict';

/**
 * Verification flow orchestration: starting a challenge on join, handling the
 * button/modal interactions, enforcing the timeout (auto kick/flag) and
 * resuming pending checks after a restart.
 */

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ChannelType,
} = require('discord.js');
const { PendingVerification, getGuildSettings } = require('../../database');
const { sendGuildLog, logger } = require('../../logger');
const captcha = require('./captcha');

const MAX_ATTEMPTS = 3;
const timers = new Map(); // `${guildId}:${userId}` -> Timeout

const key = (guildId, userId) => `${guildId}:${userId}`;

function clearTimer(guildId, userId) {
  const k = key(guildId, userId);
  const t = timers.get(k);
  if (t) {
    clearTimeout(t);
    timers.delete(k);
  }
}

function scheduleTimeout(client, guildId, userId, ms) {
  clearTimer(guildId, userId);
  const t = setTimeout(() => {
    handleTimeout(client, guildId, userId).catch((e) => logger.error('verification timeout:', e));
  }, Math.max(0, ms));
  // Do not keep the process alive solely for this timer.
  if (typeof t.unref === 'function') t.unref();
  timers.set(key(guildId, userId), t);
}

/** Remove the challenge prompt message (channel or DM), best-effort. */
async function deletePrompt(guild, pending) {
  if (!pending?.promptMessageId) return;
  try {
    if (pending.deliveredViaDm) {
      const user = await guild.client.users.fetch(pending.userId).catch(() => null);
      const dm = user ? await user.createDM().catch(() => null) : null;
      const msg = dm ? await dm.messages.fetch(pending.promptMessageId).catch(() => null) : null;
      await msg?.delete().catch(() => {});
    } else if (pending.channelId) {
      const channel =
        guild.channels.cache.get(pending.channelId) ||
        (await guild.channels.fetch(pending.channelId).catch(() => null));
      const msg = channel ? await channel.messages.fetch(pending.promptMessageId).catch(() => null) : null;
      await msg?.delete().catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

/** Begin verification for a newly joined member. */
async function startVerification(member) {
  if (member.user.bot) return;
  const guild = member.guild;
  const settings = await getGuildSettings(guild.id);
  if (!settings.verificationEnabled || !settings.verifiedRoleId) return;

  // Already verified? Skip.
  if (member.roles.cache.has(settings.verifiedRoleId)) return;

  const needsCode = settings.captchaMode !== 'button';
  const code = needsCode ? captcha.generateCode() : null;
  const timeoutMs = settings.verifyTimeoutSec * 1000;
  const expiresAt = new Date(Date.now() + timeoutMs);

  let promptMessageId = null;
  let channelId = null;
  let deliveredViaDm = false;

  if (settings.captchaDelivery === 'dm') {
    // DM delivery is inherently private — send the full challenge directly.
    const challenge = captcha.buildChallenge({
      mode: settings.captchaMode,
      guildId: guild.id,
      userId: member.id,
      code,
      guildName: guild.name,
      timeoutSec: settings.verifyTimeoutSec,
    });
    try {
      const dm = await member.send(challenge);
      promptMessageId = dm.id;
      deliveredViaDm = true;
    } catch {
      logger.debug(`Could not DM verification to ${member.user.tag}; falling back to channel.`);
    }
  }

  if (!deliveredViaDm) {
    // Channel delivery: post a compact PUBLIC "gate" message that only the
    // joining member can click. Clicking it will show the actual captcha
    // ephemerally (or grant the role directly in button mode) so no other
    // member ever sees the code / captcha image.
    const channel =
      (settings.verificationChannelId &&
        (guild.channels.cache.get(settings.verificationChannelId) ||
          (await guild.channels.fetch(settings.verificationChannelId).catch(() => null)))) ||
      null;
    if (channel?.isTextBased?.()) {
      const gate = captcha.buildGate({
        guildId: guild.id,
        userId: member.id,
        mode: settings.captchaMode,
        timeoutSec: settings.verifyTimeoutSec,
      });
      const msg = await channel.send(gate).catch((e) => {
        logger.warn(`Failed to post verification gate: ${e.message}`);
        return null;
      });
      if (msg) {
        promptMessageId = msg.id;
        channelId = channel.id;
      }
    } else {
      logger.warn(`Verification enabled for guild ${guild.id} but no valid delivery channel.`);
      return;
    }
  }

  await PendingVerification.destroy({ where: { guildId: guild.id, userId: member.id } });
  await PendingVerification.create({
    guildId: guild.id,
    userId: member.id,
    code,
    channelId,
    promptMessageId,
    deliveredViaDm,
    attempts: 0,
    expiresAt,
  });

  scheduleTimeout(member.client, guild.id, member.id, timeoutMs);
  logger.debug(`Started ${settings.captchaMode} verification for ${member.user.tag} in ${guild.name}.`);
}

/** Grant the verified role and finalise. */
async function grant(interaction, guildId, userId) {
  const guild = interaction.guild || (await interaction.client.guilds.fetch(guildId).catch(() => null));
  if (!guild) {
    return interaction.reply({ content: '❌ Could not find the server. Please contact staff.', ephemeral: true });
  }
  const settings = await getGuildSettings(guildId);
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    return interaction.reply({ content: '❌ Could not find your membership. Please rejoin.', ephemeral: true });
  }

  try {
    await member.roles.add(settings.verifiedRoleId, 'Passed verification');
  } catch (err) {
    logger.error(`Failed to add verified role in ${guild.id}: ${err.message}`);
    return interaction.reply({
      content: '❌ I could not assign the verified role. Please contact staff (check my role position).',
      ephemeral: true,
    });
  }

  clearTimer(guildId, userId);
  const pending = await PendingVerification.findOne({ where: { guildId, userId } });
  await deletePrompt(guild, pending);
  await pending?.destroy();

  await sendGuildLog(guild, {
    level: 'success',
    title: '✅ Member verified',
    fields: [{ name: 'Member', value: `<@${userId}>`, inline: true }],
  });

  return interaction.reply({ content: `✅ You are now verified in **${guild.name}**. Welcome!`, ephemeral: true });
}

/** Route a verification button click. */
async function handleButton(interaction) {
  const [, kind, guildId, userId, extra] = interaction.customId.split(':');
  if (interaction.user.id !== userId) {
    return interaction.reply({ content: 'This verification button is not for you.', ephemeral: true });
  }

  // Test/preview mode: no DB, no role change, no kick.
  if (kind === 'testhuman') {
    return interaction.reply({
      content: '✅ **Test passed** — the button captcha works. No changes were made to your account.',
      ephemeral: true,
    });
  }
  if (kind === 'testcode') {
    const modal = new ModalBuilder().setCustomId(`verify:testmodal:${guildId}:${userId}:${extra}`).setTitle('Verification (test)');
    const input = new TextInputBuilder()
      .setCustomId('code')
      .setLabel('Enter the code shown above')
      .setStyle(TextInputStyle.Short)
      .setMinLength(4)
      .setMaxLength(8)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // Public "gate" button clicked by the joining member. For button mode we
  // grant the role directly. For text/image mode we reply ephemerally with
  // the actual challenge so no other member sees the code / captcha image.
  if (kind === 'start') {
    const settings = await getGuildSettings(guildId);
    const pending = await PendingVerification.findOne({ where: { guildId, userId } });
    if (!pending) {
      return interaction.reply({
        content: 'Your verification has expired or was already completed. Please contact staff if you still lack access.',
        ephemeral: true,
      });
    }

    if (settings.captchaMode === 'button') {
      return grant(interaction, guildId, userId);
    }

    const challenge = captcha.buildChallenge({
      mode: settings.captchaMode,
      guildId,
      userId,
      code: pending.code,
      guildName: interaction.guild?.name || 'this server',
      timeoutSec: settings.verifyTimeoutSec,
    });
    return interaction.reply({
      embeds: challenge.embeds,
      components: challenge.components,
      files: challenge.files,
      ephemeral: true,
    });
  }

  if (kind === 'human') {
    return grant(interaction, guildId, userId);
  }

  if (kind === 'code') {
    const modal = new ModalBuilder().setCustomId(`verify:modal:${guildId}:${userId}`).setTitle('Verification');
    const input = new TextInputBuilder()
      .setCustomId('code')
      .setLabel('Enter the code shown above')
      .setStyle(TextInputStyle.Short)
      .setMinLength(4)
      .setMaxLength(8)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  return interaction.reply({ content: 'Unknown verification action.', ephemeral: true });
}

/** Route a verification modal submission. */
async function handleModal(interaction) {
  const [, kind, guildId, userId, extra] = interaction.customId.split(':');
  if (interaction.user.id !== userId) {
    return interaction.reply({ content: 'This verification is not for you.', ephemeral: true });
  }

  // Test/preview mode: validate against the code embedded in the customId.
  if (kind === 'testmodal') {
    const guess = interaction.fields.getTextInputValue('code').trim().toUpperCase();
    if (guess === String(extra || '').toUpperCase()) {
      return interaction.reply({
        content: '✅ **Test passed** — the code captcha works. No changes were made to your account.',
        ephemeral: true,
      });
    }
    return interaction.reply({
      content: `❌ Incorrect (test). The code was \`${extra}\`. Run \`/security verification test\` to try again.`,
      ephemeral: true,
    });
  }

  const pending = await PendingVerification.findOne({ where: { guildId, userId } });
  if (!pending) {
    return interaction.reply({
      content: 'Your verification has expired or was already completed. Please contact staff if you still lack access.',
      ephemeral: true,
    });
  }

  const answer = interaction.fields.getTextInputValue('code').trim().toUpperCase();
  if (answer === String(pending.code || '').toUpperCase()) {
    return grant(interaction, guildId, userId);
  }

  pending.attempts += 1;
  await pending.save();

  if (pending.attempts >= MAX_ATTEMPTS) {
    await interaction.reply({ content: '❌ Too many incorrect attempts.', ephemeral: true });
    return failVerification(interaction.client, guildId, userId, 'Failed captcha (too many attempts)');
  }

  return interaction.reply({
    content: `❌ Incorrect code. Attempts remaining: **${MAX_ATTEMPTS - pending.attempts}**.`,
    ephemeral: true,
  });
}

/** Apply the configured action (kick/flag) to an unverified member. */
async function failVerification(client, guildId, userId, reason) {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;
  const settings = await getGuildSettings(guildId);

  const pending = await PendingVerification.findOne({ where: { guildId, userId } });
  await deletePrompt(guild, pending);
  await pending?.destroy();
  clearTimer(guildId, userId);

  const member = await guild.members.fetch(userId).catch(() => null);
  // If they already got the role somehow, do nothing.
  if (member && settings.verifiedRoleId && member.roles.cache.has(settings.verifiedRoleId)) return;

  if (settings.unverifiedAction === 'kick' && member) {
    if (member.kickable) {
      await member.kick(reason).catch((e) => logger.warn(`Kick failed: ${e.message}`));
      await sendGuildLog(guild, {
        level: 'warn',
        title: '👢 Unverified member removed',
        fields: [
          { name: 'Member', value: `<@${userId}>`, inline: true },
          { name: 'Reason', value: reason },
        ],
      });
    } else {
      await sendGuildLog(guild, {
        level: 'warn',
        title: '⚠️ Could not remove unverified member',
        description: `I lack permission/hierarchy to kick <@${userId}>.`,
      });
    }
  } else {
    await sendGuildLog(guild, {
      level: 'warn',
      title: '🚩 Member flagged (failed verification)',
      fields: [
        { name: 'Member', value: `<@${userId}>`, inline: true },
        { name: 'Reason', value: reason },
      ],
    });
  }
}

async function handleTimeout(client, guildId, userId) {
  const pending = await PendingVerification.findOne({ where: { guildId, userId } });
  if (!pending) return; // already completed
  await failVerification(client, guildId, userId, 'Verification timed out');
}

/** On startup, resume/enforce any pending verifications. */
async function resumePending(client) {
  const rows = await PendingVerification.findAll();
  const now = Date.now();
  for (const row of rows) {
    const remaining = new Date(row.expiresAt).getTime() - now;
    if (remaining <= 0) {
      // eslint-disable-next-line no-await-in-loop
      await handleTimeout(client, row.guildId, row.userId).catch(() => {});
    } else {
      scheduleTimeout(client, row.guildId, row.userId, remaining);
    }
  }
  if (rows.length) logger.info(`Resumed ${rows.length} pending verification(s).`);
}

/** Periodic safety sweep for expired rows (in case a timer was lost). */
function startSweeper(client) {
  const interval = setInterval(() => {
    resumePendingExpiredOnly(client).catch((e) => logger.error('verification sweep:', e));
  }, 60 * 1000);
  if (typeof interval.unref === 'function') interval.unref();
}

async function resumePendingExpiredOnly(client) {
  const rows = await PendingVerification.findAll();
  const now = Date.now();
  for (const row of rows) {
    if (new Date(row.expiresAt).getTime() <= now) {
      // eslint-disable-next-line no-await-in-loop
      await handleTimeout(client, row.guildId, row.userId).catch(() => {});
    }
  }
}

module.exports = {
  startVerification,
  handleButton,
  handleModal,
  failVerification,
  resumePending,
  startSweeper,
};
