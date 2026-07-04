'use strict';

const { Events } = require('discord.js');
const { getGuildSettings } = require('../database');
const { applyPlaceholders } = require('../utils/time');
const { sendGuildLog, logger } = require('../logger');
const raid = require('../modules/security/raid');
const verification = require('../modules/security/verification');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    const guild = member.guild;
    const settings = await getGuildSettings(guild.id);
    const isBot = member.user.bot;

    // ---- Raid detection --------------------------------------------------
    if (settings.raidModeEnabled && !isBot) {
      const aggressive = settings.raidAction === 'kick' || settings.raidAction === 'lockdown';

      // Already in an active raid/lockdown window -> take action immediately.
      if (raid.isRaidActive(guild.id) && aggressive) {
        if (member.kickable) await member.kick('Raid protection (active)').catch(() => {});
        return;
      }

      const { isRaid, count } = raid.recordJoin(guild.id, {
        windowSec: settings.raidWindowSec,
        threshold: settings.raidJoinThreshold,
      });

      if (isRaid && !raid.isRaidActive(guild.id)) {
        const durationMs = settings.raidAction === 'lockdown' ? 24 * 60 * 60 * 1000 : 60 * 1000;
        raid.setRaidActive(guild.id, durationMs);
        await sendGuildLog(guild, {
          level: 'error',
          title: '🚨 Possible raid detected',
          description:
            `**${count}** members joined within ${settings.raidWindowSec}s (threshold ${settings.raidJoinThreshold}).\n` +
            `Action: **${settings.raidAction}**` +
            (settings.raidAction === 'lockdown' ? ' — run `/security raid reset` to lift the lockdown.' : '.'),
        });
        if (aggressive && member.kickable) {
          await member.kick('Raid protection').catch(() => {});
          return;
        }
      }
    }

    // ---- Verification ----------------------------------------------------
    if (settings.verificationEnabled && !isBot) {
      await verification.startVerification(member).catch((e) => logger.error('startVerification failed:', e));
    }

    // ---- Welcome message -------------------------------------------------
    if (settings.welcomeEnabled && settings.welcomeChannelId) {
      const channel =
        guild.channels.cache.get(settings.welcomeChannelId) ||
        (await guild.channels.fetch(settings.welcomeChannelId).catch(() => null));
      if (channel?.isTextBased?.()) {
        const content = applyPlaceholders(settings.welcomeMessage, { member, guild });
        channel.send({ content, allowedMentions: { users: [member.id] } }).catch(() => {});
      }
    }

    // ---- Welcome DM ------------------------------------------------------
    if (settings.welcomeDmEnabled && !isBot) {
      const content = applyPlaceholders(settings.welcomeDmMessage, { member, guild });
      member.send(content).catch(() => {
        logger.debug(`Could not DM welcome to ${member.user.tag} (DMs closed).`);
      });
    }
  },
};
