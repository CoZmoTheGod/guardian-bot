'use strict';

/**
 * Central configuration loader.
 *
 * Chooses which .env file to load based on NODE_ENV so that development and
 * production configuration can never conflict:
 *   NODE_ENV=production  -> .env.production
 *   NODE_ENV=development -> .env.dev
 *   (anything else)      -> .env
 *
 * The chosen file is optional — real deployments (Docker / Pterodactyl /
 * Pelican) usually inject variables directly into the environment, in which
 * case no file is needed.
 */

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const NODE_ENV = (process.env.NODE_ENV || 'production').toLowerCase();

const ENV_FILE_BY_MODE = {
  production: '.env.production',
  development: '.env.dev',
};

const rootDir = path.resolve(__dirname, '..');
const envFileName = ENV_FILE_BY_MODE[NODE_ENV] || '.env';
const envFilePath = path.join(rootDir, envFileName);

// Load the mode-specific file if it exists, otherwise fall back to a plain
// .env. Variables already present in the real environment always win.
if (fs.existsSync(envFilePath)) {
  dotenv.config({ path: envFilePath });
} else {
  dotenv.config(); // loads ./.env if present; silently no-ops otherwise
}

const isProduction = NODE_ENV === 'production';
const isDevelopment = NODE_ENV === 'development';

/** Small helpers for parsing environment values. */
const bool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const str = (value) => {
  if (value === undefined || value === null) return '';
  const trimmed = String(value).trim();
  return trimmed;
};

const debug = bool(process.env.DEBUG, isDevelopment);

const config = {
  env: NODE_ENV,
  isProduction,
  isDevelopment,
  envFile: fs.existsSync(envFilePath) ? envFileName : '.env',

  debug,
  // Explicit LOG_LEVEL wins; otherwise debug flag decides.
  logLevel: str(process.env.LOG_LEVEL) || (debug ? 'debug' : 'info'),

  discord: {
    token: str(process.env.DISCORD_TOKEN),
    clientId: str(process.env.CLIENT_ID),
    // In development we register commands to a single guild for instant
    // updates. In production GUILD_ID is normally empty -> global commands.
    devGuildId: str(process.env.GUILD_ID),
  },

  // sqlite://./data/guardian.sqlite  or  postgres://user:pass@host:5432/db
  databaseUrl: str(process.env.DATABASE_URL) || 'sqlite://./data/guardian.sqlite',

  youtube: {
    apiKey: str(process.env.YOUTUBE_API_KEY),
  },

  spotify: {
    clientId: str(process.env.SPOTIFY_CLIENT_ID),
    clientSecret: str(process.env.SPOTIFY_CLIENT_SECRET),
  },

  dashboard: {
    enabled: bool(process.env.DASHBOARD_ENABLED, false),
    port: Number.parseInt(str(process.env.DASHBOARD_PORT) || '3000', 10) || 3000,
    url: (str(process.env.DASHBOARD_URL) || 'http://localhost:3000').replace(/\/+$/, ''),
    sessionSecret: str(process.env.DASHBOARD_SESSION_SECRET),
    clientSecret: str(process.env.DISCORD_CLIENT_SECRET),
  },
};

/**
 * Validate the essentials. Returns an array of human-readable problems so the
 * caller can decide whether to abort (missing token) or merely warn (missing
 * optional API keys).
 */
function validate() {
  const fatal = [];
  const warnings = [];

  if (!config.discord.token || config.discord.token === 'your-bot-token-here') {
    fatal.push('DISCORD_TOKEN is missing. Set it in your environment or env file.');
  }

  if (isDevelopment && !config.discord.devGuildId) {
    warnings.push(
      'GUILD_ID is not set in development — slash commands will register globally ' +
        '(up to 1 hour to appear). Set GUILD_ID to a test server for instant updates.'
    );
  }

  if (!config.spotify.clientId || !config.spotify.clientSecret) {
    warnings.push('Spotify credentials missing — Spotify links/search will be disabled.');
  }

  if (!config.youtube.apiKey) {
    warnings.push('YOUTUBE_API_KEY missing — falling back to scraping search (less reliable).');
  }

  if (config.dashboard.enabled) {
    if (!config.dashboard.sessionSecret || config.dashboard.sessionSecret === 'change-me-to-a-long-random-string') {
      warnings.push('DASHBOARD_SESSION_SECRET is missing or default — sessions will not be secure.');
    }
    if (!config.dashboard.clientSecret || config.dashboard.clientSecret === 'your-discord-client-secret-here') {
      warnings.push('DISCORD_CLIENT_SECRET is missing — the web dashboard login flow will fail.');
    }
    if (!config.discord.clientId) {
      warnings.push('CLIENT_ID is missing — the web dashboard cannot build a Discord OAuth URL.');
    }
  }

  return { fatal, warnings };
}

module.exports = { config, validate };
