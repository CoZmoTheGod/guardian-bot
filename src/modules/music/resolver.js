'use strict';

/**
 * Resolves a user query (YouTube link, YouTube playlist, Spotify link, or plain
 * search text) into playable Track objects.
 *
 * Spotify links resolve to metadata only; the actual audio is matched and
 * streamed from YouTube (lazily, when the track is about to play) via the
 * track's `searchQuery`.
 */

const play = require('play-dl');
const spotify = require('./spotify');
const youtube = require('./youtube');
const { getYouTubeId } = require('./util');

class Track {
  constructor(data) {
    this.title = data.title || 'Unknown title';
    this.url = data.url || null; // YouTube watch URL (may be resolved lazily)
    this.duration = Number(data.duration) || 0; // seconds
    this.thumbnail = data.thumbnail || null;
    this.requestedBy = data.requestedBy || null; // { id, tag }
    this.source = data.source || 'youtube'; // 'youtube' | 'spotify'
    this.searchQuery = data.searchQuery || null; // for lazy Spotify->YouTube
    this.youtubeId = data.youtubeId || (this.url ? getYouTubeId(this.url) : null);
  }
}

function ytVideoToTrack(v, requestedBy) {
  return new Track({
    title: v.title,
    url: v.url,
    duration: v.durationInSec,
    thumbnail: v.thumbnails?.[v.thumbnails.length - 1]?.url || v.thumbnail || null,
    requestedBy,
    source: 'youtube',
  });
}

/**
 * @returns {Promise<{ tracks: Track[], playlistName?: string|null }>}
 * @throws Error with a user-friendly message on failure.
 */
async function resolveQuery(query, requestedBy) {
  const q = query.trim();

  // ---- Spotify ----------------------------------------------------------
  if (spotify.parseSpotifyUrl(q)) {
    if (!spotify.isConfigured()) {
      throw new Error('Spotify support is not configured (missing SPOTIFY_CLIENT_ID / SECRET).');
    }
    const resolved = await spotify.resolve(q);
    if (!resolved || resolved.items.length === 0) {
      throw new Error('Could not resolve that Spotify link.');
    }
    const tracks = resolved.items.map(
      (item) =>
        new Track({
          title: item.title,
          duration: item.duration,
          requestedBy,
          source: 'spotify',
          searchQuery: item.query,
        })
    );
    return { tracks, playlistName: resolved.name };
  }

  // ---- YouTube URL (video or playlist) ----------------------------------
  const ytType = play.yt_validate(q);
  if (ytType === 'playlist') {
    const playlist = await play.playlist_info(q, { incomplete: true });
    const videos = await playlist.all_videos();
    const tracks = videos.map((v) => ytVideoToTrack(v, requestedBy));
    if (tracks.length === 0) throw new Error('That YouTube playlist appears to be empty or private.');
    return { tracks, playlistName: playlist.title };
  }

  if (ytType === 'video') {
    const info = await play.video_basic_info(q);
    const d = info.video_details;
    return {
      tracks: [
        new Track({
          title: d.title,
          url: d.url,
          duration: d.durationInSec,
          thumbnail: d.thumbnails?.[d.thumbnails.length - 1]?.url || null,
          requestedBy,
          source: 'youtube',
        }),
      ],
      playlistName: null,
    };
  }

  // ---- Plain search text ------------------------------------------------
  const found = await youtube.searchOne(q);
  if (!found) throw new Error(`No results found for "${q}".`);
  return {
    tracks: [
      new Track({
        title: found.title,
        url: found.url,
        duration: found.durationInSec,
        thumbnail: found.thumbnail,
        requestedBy,
        source: 'youtube',
        youtubeId: found.id,
      }),
    ],
    playlistName: null,
  };
}

module.exports = { Track, resolveQuery };
