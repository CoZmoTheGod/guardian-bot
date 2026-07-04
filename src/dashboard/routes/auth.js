'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { logger } = require('../../logger');
const api = require('../lib/discord-api');
const { refreshAccessibleGuilds } = require('../middleware');

module.exports = function createAuthRouter(client) {
  const router = express.Router();

  // ---- Kick off OAuth --------------------------------------------------
  router.get('/login', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    return res.redirect(api.buildAuthorizeUrl(state));
  });

  // ---- OAuth callback --------------------------------------------------
  router.get('/auth/callback', async (req, res) => {
    const { code, state, error, error_description: errDesc } = req.query;
    if (error) {
      return res.status(400).render('error', {
        title: 'Discord login declined',
        message: errDesc || String(error),
      });
    }
    if (!code || !state || state !== req.session.oauthState) {
      return res.status(400).render('error', {
        title: 'Login failed',
        message: 'State mismatch or missing code. Please try again.',
      });
    }
    delete req.session.oauthState;

    try {
      const token = await api.exchangeCode(code);
      const [user, guilds] = await Promise.all([
        api.fetchCurrentUser(token.access_token),
        api.fetchUserGuilds(token.access_token),
      ]);
      req.session.user = {
        id: user.id,
        username: user.username,
        globalName: user.global_name || user.username,
        avatar: user.avatar,
        discriminator: user.discriminator,
      };
      req.session.accessToken = token.access_token;
      req.session.refreshToken = token.refresh_token;
      req.session.tokenExpiresAt = Date.now() + (token.expires_in || 604800) * 1000;
      refreshAccessibleGuilds(req.session, guilds, client);

      const to = req.session.returnTo || '/servers';
      delete req.session.returnTo;
      return res.redirect(to);
    } catch (err) {
      logger.error('[dashboard] OAuth callback failed:', err);
      return res.status(500).render('error', {
        title: 'Login failed',
        message: 'Could not complete Discord login. Please try again.',
      });
    }
  });

  // ---- Manually refresh guild list ------------------------------------
  router.post('/auth/refresh', async (req, res) => {
    if (!req.session.user || !req.session.accessToken) return res.redirect('/login');
    try {
      const guilds = await api.fetchUserGuilds(req.session.accessToken);
      refreshAccessibleGuilds(req.session, guilds, client);
    } catch (err) {
      logger.warn('[dashboard] Could not refresh guild list:', err.message);
    }
    return res.redirect('/servers');
  });

  // ---- Logout ---------------------------------------------------------
  router.post('/logout', async (req, res) => {
    const tok = req.session.accessToken;
    req.session.destroy(() => {
      api.revokeToken(tok);
      res.redirect('/');
    });
  });

  return router;
};
