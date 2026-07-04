'use strict';

/**
 * In-memory mass-join (raid) detector. Tracks join timestamps per guild within
 * a sliding window and reports when the configured threshold is exceeded.
 */

const joinLog = new Map(); // guildId -> number[] (timestamps ms)
const raidUntil = new Map(); // guildId -> timestamp ms until which raid mode is active

/**
 * Record a join and evaluate whether it constitutes a raid.
 * @returns {{ isRaid: boolean, count: number }}
 */
function recordJoin(guildId, { windowSec, threshold }) {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const recent = (joinLog.get(guildId) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  joinLog.set(guildId, recent);
  return { isRaid: recent.length >= threshold, count: recent.length };
}

function isRaidActive(guildId) {
  const until = raidUntil.get(guildId);
  return Boolean(until && Date.now() < until);
}

/** Activate raid mode for a duration (ms). */
function setRaidActive(guildId, durationMs) {
  raidUntil.set(guildId, Date.now() + durationMs);
}

function clearRaid(guildId) {
  raidUntil.delete(guildId);
  joinLog.delete(guildId);
}

module.exports = { recordJoin, isRaidActive, setRaidActive, clearRaid };
