'use strict';

/**
 * Helpers to serialise a discord.js Guild into JSON-friendly shapes for use
 * in <select> dropdowns and preview cards on settings pages.
 */

const { ChannelType, PermissionFlagsBits } = require('discord.js');

const TEXT_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
]);

/** Text channels the bot can post in, sorted by position, grouped by category. */
function listTextChannels(botGuild) {
  if (!botGuild) return [];
  const me = botGuild.members.me;
  const chans = botGuild.channels.cache
    .filter((c) => TEXT_TYPES.has(c.type))
    .map((c) => ({
      id: c.id,
      name: c.name,
      parent: c.parent?.name || null,
      position: c.rawPosition ?? c.position ?? 0,
      canSend: me
        ? c.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])
        : true,
    }));
  chans.sort((a, b) => {
    const pa = a.parent || '';
    const pb = b.parent || '';
    if (pa !== pb) return pa.localeCompare(pb);
    return a.position - b.position;
  });
  return chans;
}

/** Roles that could be assigned to members (excludes @everyone and managed). */
function listAssignableRoles(botGuild) {
  if (!botGuild) return [];
  const me = botGuild.members.me;
  const myTop = me?.roles?.highest?.position ?? 0;
  const roles = botGuild.roles.cache
    .filter((r) => r.id !== botGuild.id) // exclude @everyone
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null,
      managed: r.managed,
      position: r.position,
      // The bot can only assign roles below its own highest role.
      assignableByBot: !r.managed && r.position < myTop,
    }));
  roles.sort((a, b) => b.position - a.position);
  return roles;
}

/** Compact guild header shown at the top of every settings page. */
function guildHeader(botGuild) {
  if (!botGuild) return null;
  return {
    id: botGuild.id,
    name: botGuild.name,
    icon: botGuild.icon,
    memberCount: botGuild.memberCount,
  };
}

module.exports = { listTextChannels, listAssignableRoles, guildHeader };
