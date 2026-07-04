'use strict';

/**
 * YouTube search + info helpers. Uses the YouTube Data API v3 when
 * YOUTUBE_API_KEY is set (reliable, higher quota), otherwise falls back to
 * play-dl's scraping search. Streaming itself is always handled by play-dl.
 */

const play = require('play-dl');
const { config } = require('../../config');
const { logger } = require('../../logger');

async function searchViaDataApi(query, limit) {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', String(limit));
  url.searchParams.set('key', config.youtube.apiKey);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube Data API search failed (${res.status}).`);
  const json = await res.json();
  return (json.items || []).map((it) => ({
    id: it.id.videoId,
    url: `https://www.youtube.com/watch?v=${it.id.videoId}`,
    title: it.snippet.title,
    thumbnail: it.snippet.thumbnails?.default?.url || null,
    durationInSec: 0, // not returned by search.list; filled in when streamed
  }));
}

async function searchViaPlayDl(query, limit) {
  const results = await play.search(query, { source: { youtube: 'video' }, limit });
  return results.map((r) => ({
    id: r.id,
    url: r.url,
    title: r.title,
    thumbnail: r.thumbnails?.[0]?.url || null,
    durationInSec: r.durationInSec || 0,
  }));
}

/** Search YouTube and return up to `limit` normalised video results. */
async function searchVideos(query, limit = 5) {
  if (config.youtube.apiKey) {
    try {
      return await searchViaDataApi(query, limit);
    } catch (err) {
      logger.warn(`${err.message} Falling back to play-dl search.`);
    }
  }
  return searchViaPlayDl(query, limit);
}

/** Return the single best match for a query, or null. */
async function searchOne(query) {
  const [first] = await searchVideos(query, 1);
  return first || null;
}

module.exports = { searchVideos, searchOne };
