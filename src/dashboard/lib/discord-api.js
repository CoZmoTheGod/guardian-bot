'use strict';

/**
 * Thin wrappers around the Discord REST API for the dashboard's OAuth2 flow.
 * No third-party OAuth library is used — the flow is only four HTTP calls.
 */

const { config } = require('../../config');

const OAUTH_BASE = 'https://discord.com/api/v10';

/**
 * Build the authorization URL to redirect the user to for consent.
 * `state` is echoed back to us and used to prevent CSRF on the callback.
 */
function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: config.discord.clientId,
    redirect_uri: `${config.dashboard.url}/auth/callback`,
    response_type: 'code',
    scope: 'identify guilds',
    prompt: 'none',
    state,
  });
  return `${OAUTH_BASE}/oauth2/authorize?${params.toString()}`;
}

/** Exchange an auth code for an access token. */
async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: config.discord.clientId,
    client_secret: config.dashboard.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${config.dashboard.url}/auth/callback`,
  });
  const res = await fetch(`${OAUTH_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  return res.json(); // { access_token, refresh_token, expires_in, scope, token_type }
}

/** GET /users/@me — the currently authenticated user. */
async function fetchCurrentUser(accessToken) {
  const res = await fetch(`${OAUTH_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`fetchCurrentUser failed: ${res.status}`);
  return res.json();
}

/** GET /users/@me/guilds — partial guild objects with the user's permissions. */
async function fetchUserGuilds(accessToken) {
  const res = await fetch(`${OAUTH_BASE}/users/@me/guilds?with_counts=false`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`fetchUserGuilds failed: ${res.status}`);
  return res.json();
}

/** Revoke a token when the user logs out (best-effort). */
async function revokeToken(token) {
  if (!token) return;
  try {
    await fetch(`${OAUTH_BASE}/oauth2/token/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.discord.clientId,
        client_secret: config.dashboard.clientSecret,
        token,
      }),
    });
  } catch {
    /* best-effort */
  }
}

module.exports = {
  buildAuthorizeUrl,
  exchangeCode,
  fetchCurrentUser,
  fetchUserGuilds,
  revokeToken,
};
