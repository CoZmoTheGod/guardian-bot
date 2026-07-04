'use strict';

/**
 * Lightweight logger with levels, colourised console output and an optional
 * per-guild Discord log channel mirror.
 *
 * Levels (in increasing verbosity): error < warn < info < debug
 * The active level comes from config.logLevel (driven by LOG_LEVEL / DEBUG).
 */

const { EmbedBuilder } = require('discord.js');
const { config } = require('./config');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
};

const LEVEL_META = {
  error: { color: COLORS.red, tag: 'ERROR' },
  warn: { color: COLORS.yellow, tag: 'WARN ' },
  info: { color: COLORS.green, tag: 'INFO ' },
  debug: { color: COLORS.magenta, tag: 'DEBUG' },
};

const EMBED_COLORS = {
  error: 0xed4245,
  warn: 0xfee75c,
  info: 0x5865f2,
  success: 0x57f287,
};

function timestamp() {
  return new Date().toISOString();
}

function threshold() {
  return LEVELS[config.logLevel] ?? LEVELS.info;
}

function write(level, args) {
  if ((LEVELS[level] ?? LEVELS.info) > threshold()) return;
  const meta = LEVEL_META[level] || LEVEL_META.info;
  const prefix = `${COLORS.gray}${timestamp()}${COLORS.reset} ${meta.color}[${meta.tag}]${COLORS.reset}`;
  const stream = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  stream(prefix, ...args);
}

const logger = {
  error: (...args) => write('error', args),
  warn: (...args) => write('warn', args),
  info: (...args) => write('info', args),
  debug: (...args) => write('debug', args),

  /** Log a section header (info level). */
  banner(text) {
    if (LEVELS.info > threshold()) return;
    console.log(`${COLORS.cyan}${text}${COLORS.reset}`);
  },
};

/**
 * Mirror an event to a guild's configured log channel (best-effort).
 * Never throws — logging must not break the bot.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} opts
 * @param {'error'|'warn'|'info'|'success'} [opts.level]
 * @param {string} opts.title
 * @param {string} [opts.description]
 * @param {Array<{name:string,value:string,inline?:boolean}>} [opts.fields]
 */
async function sendGuildLog(guild, opts) {
  try {
    if (!guild) return;
    // Lazy require to avoid a circular dependency with the database layer.
    const { getGuildSettings } = require('./database');
    const settings = await getGuildSettings(guild.id);
    if (!settings?.logChannelId) return;

    const channel = guild.channels.cache.get(settings.logChannelId)
      || (await guild.channels.fetch(settings.logChannelId).catch(() => null));
    if (!channel || !channel.isTextBased?.()) return;

    const level = opts.level || 'info';
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS[level] ?? EMBED_COLORS.info)
      .setTitle(opts.title)
      .setTimestamp();

    if (opts.description) embed.setDescription(opts.description);
    if (opts.fields?.length) embed.addFields(opts.fields);

    await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.debug('sendGuildLog failed:', err.message);
  }
}

module.exports = { logger, sendGuildLog };
