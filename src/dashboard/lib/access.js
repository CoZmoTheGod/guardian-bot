'use strict';

/**
 * Access-control helpers.
 *
 * The dashboard's authorization model is deliberately simple: a logged-in
 * Discord user is allowed to configure a guild if and only if
 *   (1) the bot is currently in that guild, AND
 *   (2) the user has the "Manage Server" permission there (owners always do).
 *
 * That means: give someone the dashboard URL, they log in with their own
 * Discord account, and they see only the servers they can already manage on
 * Discord itself. No custom permission system is required.
 */

const PERM_ADMINISTRATOR = 1n << 3n; // 0x00000008
const PERM_MANAGE_GUILD = 1n << 5n; // 0x00000020

/** Return true if the OAuth partial-guild grants Manage Server to the user. */
function userCanManage(partialGuild) {
  if (!partialGuild) return false;
  if (partialGuild.owner === true) return true;
  let perms;
  try {
    perms = BigInt(partialGuild.permissions ?? '0');
  } catch {
    return false;
  }
  return (perms & PERM_ADMINISTRATOR) !== 0n || (perms & PERM_MANAGE_GUILD) !== 0n;
}

/**
 * Filter the user's guild list down to those the bot is also present in AND
 * the user has Manage Server on. Returns an array of enriched objects.
 */
function accessibleGuilds(userGuilds, botClient) {
  if (!Array.isArray(userGuilds) || !botClient) return [];
  const out = [];
  for (const g of userGuilds) {
    if (!userCanManage(g)) continue;
    const botGuild = botClient.guilds.cache.get(g.id);
    if (!botGuild) continue;
    out.push({
      id: g.id,
      name: botGuild.name || g.name,
      icon: botGuild.icon || g.icon,
      memberCount: botGuild.memberCount ?? null,
      owner: g.owner === true,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

module.exports = { accessibleGuilds, userCanManage };
