'use strict';

const crypto = require('node:crypto');
const { accessibleGuilds } = require('./lib/access');

/** Redirect unauthenticated visitors to /login. */
function requireLogin(req, res, next) {
  if (req.session?.user) return next();
  req.session.returnTo = req.originalUrl;
  return res.redirect('/login');
}

/**
 * For any route with a :guildId param, verify the logged-in user still has
 * access to that guild and attach:
 *   req.guildId          — the validated guild id
 *   req.botGuild         — the discord.js Guild instance (bot's view)
 *   req.accessibleGuilds — cached list from the session
 */
function requireGuildAccess(client) {
  return function (req, res, next) {
    const gid = req.params.guildId;
    if (!gid || !/^\d{5,25}$/.test(gid)) {
      return res.status(400).render('error', { title: 'Bad request', message: 'Invalid guild id.' });
    }
    const list = req.session?.accessibleGuilds || [];
    const match = list.find((g) => g.id === gid);
    if (!match) {
      return res.status(403).render('error', {
        title: 'Access denied',
        message: 'You do not have permission to manage this server, or the bot is not in it.',
      });
    }
    const botGuild = client.guilds.cache.get(gid);
    if (!botGuild) {
      return res.status(404).render('error', {
        title: 'Server unavailable',
        message: 'The bot is no longer in this server.',
      });
    }
    req.guildId = gid;
    req.botGuild = botGuild;
    req.accessibleGuild = match;
    return next();
  };
}

/**
 * Minimal synchronizer-token CSRF: a random token is stored in the session
 * and echoed back in every state-changing form. Templates render it into a
 * hidden `_csrf` input via `res.locals.csrfToken`.
 */
function csrf(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (req.method === 'POST') {
    const supplied = (req.body && req.body._csrf) || req.get('x-csrf-token');
    if (!supplied || supplied !== req.session.csrfToken) {
      return res.status(403).render('error', {
        title: 'CSRF check failed',
        message: 'Please reload the page and try again.',
      });
    }
  }
  return next();
}

/** Expose commonly used values to every EJS template. */
function templateGlobals(req, res, next) {
  res.locals.currentUser = req.session?.user || null;
  res.locals.currentPath = req.path;
  res.locals.currentGuildId = req.params.guildId || null;
  res.locals.flashes = req.session?.flashes || [];
  if (req.session) req.session.flashes = [];
  res.locals.accessibleGuilds = req.session?.accessibleGuilds || [];
  next();
}

/** Push a flash message onto the session so the next render can show it. */
function flash(req, type, text) {
  if (!req.session) return;
  req.session.flashes = req.session.flashes || [];
  req.session.flashes.push({ type, text });
}

/** Convenience for filtering the user's guilds after fetching them. */
function refreshAccessibleGuilds(session, userGuilds, client) {
  session.accessibleGuilds = accessibleGuilds(userGuilds, client);
  return session.accessibleGuilds;
}

module.exports = {
  requireLogin,
  requireGuildAccess,
  csrf,
  templateGlobals,
  flash,
  refreshAccessibleGuilds,
};
