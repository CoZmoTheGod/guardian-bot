'use strict';

/**
 * Server backup & restore.
 *
 * snapshot(guild) -> a portable JSON object describing roles, channels
 * (categories, overwrites, topics), @everyone permissions and emoji.
 *
 * restore(guild, data, opts) -> recreates that structure in a guild, mapping
 * old role IDs to freshly created ones. Every item is created defensively so a
 * single failure never aborts the whole restore.
 */

const { ChannelType, PermissionsBitField } = require('discord.js');
const { logger } = require('../../logger');

const SNAPSHOT_VERSION = 1;

// Channel types we back up, split into categories vs. the rest.
const RESTORABLE_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildVoice,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
  ChannelType.GuildCategory,
]);

function serialiseOverwrites(channel) {
  return [...channel.permissionOverwrites.cache.values()].map((ow) => ({
    id: ow.id, // original role id (equals source guild id for @everyone) or member id
    type: ow.type, // 0 = role, 1 = member
    allow: ow.allow.bitfield.toString(),
    deny: ow.deny.bitfield.toString(),
  }));
}

/** Build a full snapshot of a guild. */
async function snapshot(guild) {
  // Ensure caches are populated.
  await guild.roles.fetch().catch(() => {});
  await guild.channels.fetch().catch(() => {});

  const roles = [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position) // highest first
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      hoist: r.hoist,
      mentionable: r.mentionable,
      permissions: r.permissions.bitfield.toString(),
      position: r.position,
    }));

  const allChannels = [...guild.channels.cache.values()].filter((c) => RESTORABLE_TYPES.has(c.type));

  const categories = allChannels
    .filter((c) => c.type === ChannelType.GuildCategory)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, name: c.name, position: c.position, overwrites: serialiseOverwrites(c) }));

  const channels = allChannels
    .filter((c) => c.type !== ChannelType.GuildCategory)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((c) => ({
      name: c.name,
      type: c.type,
      parentId: c.parentId || null,
      position: c.rawPosition,
      topic: c.topic || null,
      nsfw: Boolean(c.nsfw),
      rateLimitPerUser: c.rateLimitPerUser || 0,
      bitrate: c.bitrate || null,
      userLimit: typeof c.userLimit === 'number' ? c.userLimit : null,
      overwrites: serialiseOverwrites(c),
    }));

  const emojis = [...guild.emojis.cache.values()].map((e) => ({
    name: e.name,
    url: e.imageURL({ size: 128 }),
    animated: e.animated,
  }));

  return {
    version: SNAPSHOT_VERSION,
    guildId: guild.id, // original guild id (used to detect @everyone overwrites)
    guildName: guild.name,
    createdAt: new Date().toISOString(),
    everyonePermissions: guild.roles.everyone.permissions.bitfield.toString(),
    roles,
    categories,
    channels,
    emojis,
  };
}

/** Summary counts for a snapshot (for list/info displays). */
function describe(data) {
  return {
    roles: data.roles?.length || 0,
    categories: data.categories?.length || 0,
    channels: data.channels?.length || 0,
    emojis: data.emojis?.length || 0,
  };
}

function mapOverwrites(overwrites, data, roleMap, guild) {
  const result = [];
  for (const ow of overwrites || []) {
    if (ow.type === 0) {
      // role overwrite
      const newId = ow.id === data.guildId ? guild.id : roleMap.get(ow.id);
      if (!newId) continue;
      result.push({ id: newId, allow: BigInt(ow.allow), deny: BigInt(ow.deny) });
    } else {
      // member overwrite — only if that member is present in the target guild
      if (guild.members.cache.has(ow.id)) {
        result.push({ id: ow.id, allow: BigInt(ow.allow), deny: BigInt(ow.deny) });
      }
    }
  }
  return result;
}

/** Optionally wipe existing roles/channels/emoji before restoring. */
async function clearGuild(guild, summary) {
  const me = guild.members.me;
  for (const channel of [...guild.channels.cache.values()]) {
    // eslint-disable-next-line no-await-in-loop
    await channel.delete('Backup restore (clear)').catch(() => {});
  }
  for (const role of [...guild.roles.cache.values()]) {
    if (role.id === guild.id || role.managed) continue;
    if (role.position >= me.roles.highest.position) continue;
    // eslint-disable-next-line no-await-in-loop
    await role.delete('Backup restore (clear)').catch(() => {});
  }
  for (const emoji of [...guild.emojis.cache.values()]) {
    // eslint-disable-next-line no-await-in-loop
    await emoji.delete('Backup restore (clear)').catch(() => {});
  }
  summary.cleared = true;
}

/**
 * Restore a snapshot into a guild.
 * @param {object} opts { clear?: boolean }
 * @returns summary object with counts and any errors.
 */
async function restore(guild, data, opts = {}) {
  const summary = { rolesCreated: 0, categoriesCreated: 0, channelsCreated: 0, emojisCreated: 0, errors: [], cleared: false };

  if (!data || data.version !== SNAPSHOT_VERSION) {
    throw new Error('Backup format is unsupported or corrupted.');
  }

  if (opts.clear) {
    await clearGuild(guild, summary);
  }

  // ---- @everyone base permissions ---------------------------------------
  try {
    await guild.roles.everyone.setPermissions(BigInt(data.everyonePermissions), 'Backup restore');
  } catch (err) {
    summary.errors.push(`@everyone permissions: ${err.message}`);
  }

  // ---- Roles (highest first so hierarchy is preserved) ------------------
  const roleMap = new Map(); // oldId -> newRole
  for (const role of data.roles) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const created = await guild.roles.create({
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        mentionable: role.mentionable,
        permissions: BigInt(role.permissions),
        reason: 'Backup restore',
      });
      roleMap.set(role.id, created.id);
      summary.rolesCreated += 1;
    } catch (err) {
      summary.errors.push(`Role "${role.name}": ${err.message}`);
    }
  }

  // ---- Categories -------------------------------------------------------
  const categoryMap = new Map(); // oldCategoryId -> newCategoryId
  for (const cat of data.categories) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const created = await guild.channels.create({
        name: cat.name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: mapOverwrites(cat.overwrites, data, roleMap, guild),
        reason: 'Backup restore',
      });
      categoryMap.set(cat.id, created.id);
      summary.categoriesCreated += 1;
    } catch (err) {
      summary.errors.push(`Category "${cat.name}": ${err.message}`);
    }
  }

  // ---- Channels ---------------------------------------------------------
  for (const ch of data.channels) {
    try {
      const base = {
        name: ch.name,
        type: ch.type,
        parent: ch.parentId ? categoryMap.get(ch.parentId) || undefined : undefined,
        permissionOverwrites: mapOverwrites(ch.overwrites, data, roleMap, guild),
        reason: 'Backup restore',
      };
      if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement || ch.type === ChannelType.GuildForum) {
        base.topic = ch.topic || undefined;
        base.nsfw = ch.nsfw;
        base.rateLimitPerUser = ch.rateLimitPerUser || 0;
      }
      if (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice) {
        if (ch.bitrate) base.bitrate = Math.min(ch.bitrate, guild.maximumBitrate);
        if (ch.userLimit != null) base.userLimit = ch.userLimit;
      }
      // eslint-disable-next-line no-await-in-loop
      await guild.channels.create(base);
      summary.channelsCreated += 1;
    } catch (err) {
      summary.errors.push(`Channel "${ch.name}": ${err.message}`);
    }
  }

  // ---- Emojis -----------------------------------------------------------
  for (const emoji of data.emojis) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await guild.emojis.create({ attachment: emoji.url, name: emoji.name, reason: 'Backup restore' });
      summary.emojisCreated += 1;
    } catch (err) {
      summary.errors.push(`Emoji "${emoji.name}": ${err.message}`);
    }
  }

  logger.info(
    `Restore in ${guild.id}: ${summary.rolesCreated} roles, ${summary.categoriesCreated} categories, ` +
      `${summary.channelsCreated} channels, ${summary.emojisCreated} emoji, ${summary.errors.length} error(s).`
  );
  return summary;
}

module.exports = { snapshot, restore, describe, SNAPSHOT_VERSION };
