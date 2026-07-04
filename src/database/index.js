'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Sequelize } = require('sequelize');
const { config } = require('../config');
const { logger } = require('../logger');

/**
 * Build a Sequelize instance from DATABASE_URL, supporting both SQLite (default,
 * zero-config) and PostgreSQL. SQLite URLs look like `sqlite://./data/x.sqlite`;
 * anything else is passed straight through (e.g. `postgres://...`).
 */
function buildSequelize() {
  const url = config.databaseUrl;
  const logging = config.debug ? (msg) => logger.debug(`[sql] ${msg}`) : false;

  if (url.startsWith('sqlite:')) {
    // Strip the scheme; support sqlite::memory:, sqlite://./rel and sqlite:///abs
    let storage = url.replace(/^sqlite:(\/\/)?/, '');
    if (!storage || storage === ':memory:') {
      storage = ':memory:';
    } else {
      storage = path.resolve(process.cwd(), storage);
      fs.mkdirSync(path.dirname(storage), { recursive: true });
    }
    return new Sequelize({ dialect: 'sqlite', storage, logging });
  }

  // Postgres / MySQL etc. Enable SSL when the URL asks for it (common on hosts).
  const needsSsl = /sslmode=require/i.test(url) || /[?&]ssl=true/i.test(url);
  return new Sequelize(url, {
    logging,
    dialectOptions: needsSsl ? { ssl: { require: true, rejectUnauthorized: false } } : {},
    pool: { max: 5, min: 0, idle: 10000 },
  });
}

const sequelize = buildSequelize();

// ---- Load models ----------------------------------------------------------
const GuildSettings = require('./models/GuildSettings')(sequelize);
const ChannelLock = require('./models/ChannelLock')(sequelize);
const ReactionRoleMessage = require('./models/ReactionRoleMessage')(sequelize);
const ReactionRoleMapping = require('./models/ReactionRoleMapping')(sequelize);
const Backup = require('./models/Backup')(sequelize);
const PendingVerification = require('./models/PendingVerification')(sequelize);

// ---- Associations ---------------------------------------------------------
ReactionRoleMessage.hasMany(ReactionRoleMapping, {
  foreignKey: 'messageId',
  sourceKey: 'messageId',
  as: 'mappings',
  onDelete: 'CASCADE',
});
ReactionRoleMapping.belongsTo(ReactionRoleMessage, {
  foreignKey: 'messageId',
  targetKey: 'messageId',
  as: 'panel',
});

const models = {
  GuildSettings,
  ChannelLock,
  ReactionRoleMessage,
  ReactionRoleMapping,
  Backup,
  PendingVerification,
};

/**
 * Idempotent, in-place column additions for existing databases. Sequelize's
 * default `sync()` never mutates existing tables, so when we add a new field
 * to a model we also need to teach the running instance how to migrate a
 * previously-created schema. Every entry runs at most once per column: if
 * the column already exists (fresh install or previous run) we skip it.
 */
async function runAutoMigrations() {
  const qi = sequelize.getQueryInterface();
  const additions = [
    ['guild_settings', 'welcomeCardEnabled', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false }],
    ['guild_settings', 'welcomeCardTitle', { type: Sequelize.TEXT, allowNull: false, defaultValue: '{user.name} just joined the server' }],
    ['guild_settings', 'welcomeCardSubtitle', { type: Sequelize.TEXT, allowNull: false, defaultValue: 'Member #{memberCount}' }],
    ['guild_settings', 'welcomeCardTitleColor', { type: Sequelize.STRING, allowNull: false, defaultValue: '#ffffff' }],
    ['guild_settings', 'welcomeCardSubtitleColor', { type: Sequelize.STRING, allowNull: false, defaultValue: '#cccccc' }],
    ['guild_settings', 'welcomeCardAccentColor', { type: Sequelize.STRING, allowNull: false, defaultValue: '#5865f2' }],
  ];

  let existing;
  try {
    existing = await qi.describeTable('guild_settings');
  } catch {
    return; // Table not created yet — sync() will create it with all columns.
  }

  for (const [table, column, spec] of additions) {
    if (existing[column]) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await qi.addColumn(table, column, spec);
      logger.info(`DB migration: added column ${table}.${column}`);
    } catch (err) {
      logger.warn(`DB migration: could not add ${table}.${column}: ${err.message}`);
    }
  }
}

/** Connect and create any missing tables. */
async function connect() {
  await sequelize.authenticate();
  await runAutoMigrations();
  await sequelize.sync();
  logger.info(`Database connected (${sequelize.getDialect()}).`);
}

/** In-process cache of guild settings to avoid a DB hit on every event. */
const settingsCache = new Map();

/** Fetch (creating if needed) the settings row for a guild. */
async function getGuildSettings(guildId) {
  if (settingsCache.has(guildId)) return settingsCache.get(guildId);
  const [row] = await GuildSettings.findOrCreate({ where: { guildId } });
  settingsCache.set(guildId, row);
  return row;
}

/** Persist changes to a guild's settings and refresh the cache. */
async function updateGuildSettings(guildId, values) {
  const row = await getGuildSettings(guildId);
  await row.update(values);
  settingsCache.set(guildId, row);
  return row;
}

/** Drop a guild from the cache (e.g. on settings reset / guild leave). */
function invalidateGuildSettings(guildId) {
  settingsCache.delete(guildId);
}

module.exports = {
  sequelize,
  Sequelize,
  ...models,
  models,
  connect,
  getGuildSettings,
  updateGuildSettings,
  invalidateGuildSettings,
};
