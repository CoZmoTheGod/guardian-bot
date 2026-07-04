'use strict';

/**
 * Guardian web dashboard.
 *
 * A small Express app that:
 *   - authenticates visitors via Discord OAuth2 (identify + guilds scopes),
 *   - shows each user only the guilds they can manage AND that the bot is in,
 *   - lets them edit per-guild settings backed by the same Sequelize models
 *     the slash commands use.
 *
 * The dashboard is opt-in (`DASHBOARD_ENABLED=true`) and lives alongside the
 * bot in the same process. Nothing here talks to Discord's gateway — reads
 * are cached from the discord.js Client instance, writes go straight to the
 * database (which every feature already re-reads on demand).
 */

const path = require('node:path');
const express = require('express');
const session = require('express-session');
const { config } = require('../config');
const { logger } = require('../logger');
const middleware = require('./middleware');
const createAuthRouter = require('./routes/auth');
const createServersRouter = require('./routes/servers');

/**
 * Start the dashboard. Returns the http.Server so callers can close it.
 * Safe to call once the discord.js Client is ready.
 */
function startDashboard(client) {
  if (!config.dashboard.enabled) {
    logger.info('[dashboard] DASHBOARD_ENABLED=false — skipping web dashboard.');
    return null;
  }
  if (!config.dashboard.clientSecret || config.dashboard.clientSecret === 'your-discord-client-secret-here') {
    logger.warn(
      '[dashboard] DISCORD_CLIENT_SECRET is missing — dashboard NOT started. ' +
        'Grab it from Discord Developer Portal → OAuth2 → Client Secret, ' +
        `and add ${config.dashboard.url}/auth/callback under OAuth2 → Redirects.`
    );
    return null;
  }

  const app = express();
  app.set('trust proxy', 1); // sensible default behind a reverse proxy
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');

  // Static assets
  app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

  // Body parsing (forms only — we never accept JSON)
  app.use(express.urlencoded({ extended: false, limit: '128kb' }));

  // Session store: in-memory. Fine for a small self-hosted admin panel;
  // switch to connect-sqlite3 / connect-pg-simple for horizontal scaling.
  app.use(
    session({
      name: 'guardian.sid',
      secret: config.dashboard.sessionSecret || 'guardian-insecure-default-please-change',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.dashboard.url.startsWith('https://'),
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      },
    })
  );

  // Basic security headers (Helmet-lite, no dep).
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; " +
        "img-src 'self' https://cdn.discordapp.com data:; " +
        "style-src 'self' 'unsafe-inline'; " +
        "script-src 'self'; " +
        "form-action 'self' https://discord.com; " +
        "connect-src 'self'; " +
        "frame-ancestors 'none'"
    );
    next();
  });

  app.use(middleware.templateGlobals);
  app.use(middleware.csrf);

  // ---- Public routes --------------------------------------------------
  app.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/servers');
    res.render('login', { title: 'Guardian dashboard' });
  });

  app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

  // ---- OAuth routes ---------------------------------------------------
  app.use(createAuthRouter(client));

  // ---- Authenticated routes ------------------------------------------
  app.use(middleware.requireLogin, createServersRouter(client));

  // ---- 404 & error handlers ------------------------------------------
  app.use((_req, res) => {
    res.status(404).render('error', {
      title: 'Not found',
      message: 'That page does not exist.',
    });
  });

  app.use((err, _req, res, _next) => {
    logger.error('[dashboard] unhandled route error:', err);
    res.status(500).render('error', {
      title: 'Something broke',
      message: 'An unexpected error occurred. Check the bot log for details.',
    });
  });

  const server = app.listen(config.dashboard.port, () => {
    logger.info(`[dashboard] Web panel listening on ${config.dashboard.url} (port ${config.dashboard.port})`);
    logger.info(
      `[dashboard] Register redirect URI in Discord Developer Portal → OAuth2 → Redirects: ${config.dashboard.url}/auth/callback`
    );
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`[dashboard] Port ${config.dashboard.port} already in use — dashboard not started.`);
    } else {
      logger.error('[dashboard] server error:', err);
    }
  });

  return server;
}

module.exports = { startDashboard };
