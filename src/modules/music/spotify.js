'use strict';

/**
 * Minimal Spotify Web API client using the Client Credentials flow.
 * We only read public metadata (track/album/playlist names + artists) which is
 * then used as a search query against YouTube for actual playback — exactly as
 * the brief requires. No user auth / refresh token needed.
 */

const { config } = require('../../config');
const { logger } = require('../../logger');

let cachedToken = null;
let tokenExpiresAt = 0;

function isConfigured() {
  return Boolean(config.spotify.clientId && config.spotify.clientSecret);
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 5000) return cachedToken;
  if (!isConfigured()) throw new Error('Spotify credentials are not configured.');

  const auth = Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify auth failed (${res.status}).`);
  const json = await res.json();
  cachedToken = json.access_token;
  tokenExpiresAt = Date.now() + json.expires_in * 1000;
  return cachedToken;
}

async function apiGet(fullOrPath) {
  const token = await getToken();
  const url = fullOrPath.startsWith('http') ? fullOrPath : `https://api.spotify.com/v1${fullOrPath}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Spotify request failed (${res.status}) for ${url}`);
  return res.json();
}

/** Parse a Spotify URL/URI into { type, id } or null. */
function parseSpotifyUrl(input) {
  const web = input.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist)\/([A-Za-z0-9]+)/i);
  if (web) return { type: web[1].toLowerCase(), id: web[2] };
  const uri = input.match(/spotify:(track|album|playlist):([A-Za-z0-9]+)/i);
  if (uri) return { type: uri[1].toLowerCase(), id: uri[2] };
  return null;
}

function toItem(track) {
  const artists = (track.artists || []).map((a) => a.name);
  const artistStr = artists.join(', ');
  return {
    query: `${artists.join(' ')} ${track.name}`.trim(),
    title: artistStr ? `${artistStr} - ${track.name}` : track.name,
    duration: Math.round((track.duration_ms || 0) / 1000),
  };
}

async function paginate(firstPage) {
  const items = [];
  let page = firstPage;
  // eslint-disable-next-line no-constant-condition
  while (page) {
    items.push(page);
    if (!page.next) break;
    page = await apiGet(page.next); // eslint-disable-line no-await-in-loop
  }
  return items;
}

/**
 * Resolve a Spotify URL into { name, items: [{ query, title, duration }] }.
 * Returns null if the URL is not a Spotify link.
 */
async function resolve(input) {
  const parsed = parseSpotifyUrl(input);
  if (!parsed) return null;

  if (parsed.type === 'track') {
    const t = await apiGet(`/tracks/${parsed.id}`);
    return { name: null, items: [toItem(t)] };
  }

  if (parsed.type === 'album') {
    const album = await apiGet(`/albums/${parsed.id}`);
    const pages = await paginate(album.tracks);
    const items = pages.flatMap((p) => p.items.map(toItem));
    return { name: album.name, items };
  }

  if (parsed.type === 'playlist') {
    const pl = await apiGet(`/playlists/${parsed.id}`);
    const pages = await paginate(pl.tracks);
    const items = pages
      .flatMap((p) => p.items)
      .filter((i) => i && i.track && !i.track.is_local)
      .map((i) => toItem(i.track));
    return { name: pl.name, items };
  }

  return null;
}

module.exports = { isConfigured, resolve, parseSpotifyUrl };
