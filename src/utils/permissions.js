'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { getGuildSettings } = require('../database');

/**
 * Whether a member may run backup/restore commands: the guild owner, any
 * Administrator, or the configured backup permission role.
 */
async function canManageBackups(member) {
  if (!member?.guild) return false;
  if (member.id === member.guild.ownerId) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  const settings = await getGuildSettings(member.guild.id);
  if (settings.backupPermRoleId && member.roles.cache.has(settings.backupPermRoleId)) {
    return true;
  }
  return false;
}

/**
 * Whether a member may run DJ-restricted music actions. If no DJ role is
 * configured, everyone qualifies. Administrators always qualify.
 */
async function isDj(member) {
  if (!member?.guild) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const settings = await getGuildSettings(member.guild.id);
  if (!settings.djRoleId) return true;
  return member.roles.cache.has(settings.djRoleId);
}

module.exports = { canManageBackups, isDj };
