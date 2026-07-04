'use strict';

/**
 * SponsorBlock integration — fetches community-marked segments (sponsor spots,
 * intros, self-promo, etc.) so the player can automatically skip them.
 */

const { randomUUID } = require('node:crypto');
const { SponsorBlock } = require('sponsorblock-api');
const { logger } = require('../../logger');

// Categories we auto-skip. "music_offtopic" is great for non-music portions of
// music videos; "preview" for recap/preview segments.
const CATEGORIES = ['sponsor', 'intro', 'outro', 'selfpromo', 'interaction', 'music_offtopic', 'preview'];

// SponsorBlock wants a stable anonymous user id; a random one is fine for reads.
const sb = new SponsorBlock(randomUUID());

/**
 * Return sorted skip segments for a YouTube video id:
 * [{ start, end, category }] in seconds. Empty array if none / on error.
 */
async function getSegments(videoId) {
  if (!videoId) return [];
  try {
    const segments = await sb.getSegments(videoId, CATEGORIES);
    return segments
      .map((s) => ({ start: s.startTime, end: s.endTime, category: s.category }))
      .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
      .sort((a, b) => a.start - b.start);
  } catch (err) {
    // 404 simply means "no segments submitted" — not an error worth surfacing.
    if (err && (err.status === 404 || /404/.test(String(err.message)))) return [];
    logger.debug(`SponsorBlock lookup failed for ${videoId}: ${err.message}`);
    return [];
  }
}

module.exports = { getSegments, CATEGORIES };
