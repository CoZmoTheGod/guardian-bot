'use strict';

/**
 * Guardian — All-in-One Discord Bot
 * Main entry point: validates config, wires up the client, loads commands and
 * events, connects the database and logs in.
 */

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { config, validate } = require('./config');
const { logger } = require('./logger');
const { loadCommands, loadEvents } = require('./loaders');
const db = require('./database');
const { startDashboard } = require('./dashboard');

async function main() {
  logger.banner('╔══════════════════════════════════════╗');
  logger.banner('║   Guardian Discord Bot — starting…   ║');
  logger.banner('╚══════════════════════════════════════╝');
  logger.info(`Environment: ${config.env} (env file: ${config.envFile}, debug: ${config.debug})`);

  // ---- Validate configuration -------------------------------------------
  const { fatal, warnings } = validate();
  warnings.forEach((w) => logger.warn(w));
  if (fatal.length) {
    fatal.forEach((f) => logger.error(f));
    logger.error('Aborting startup due to fatal configuration errors.');
    process.exit(1);
  }

  // ---- Database ----------------------------------------------------------
  try {
    await db.connect();
  } catch (err) {
    logger.error('Failed to connect to the database:', err);
    process.exit(1);
  }

  // ---- Client ------------------------------------------------------------
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers, // privileged: join/leave, verification
      GatewayIntentBits.GuildMessages, // ghost-ping detection
      GatewayIntentBits.GuildMessageReactions, // reaction roles
      GatewayIntentBits.GuildVoiceStates, // music
    ],
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
      Partials.GuildMember,
      Partials.User,
    ],
  });

  client.config = config;

  loadCommands(client);
  loadEvents(client);

  // ---- Process-level safety nets -----------------------------------------
  process.on('unhandledRejection', (reason) => logger.error('Unhandled promise rejection:', reason));
  process.on('uncaughtException', (err) => logger.error('Uncaught exception:', err));

  const shutdown = async (signal) => {
    logger.warn(`Received ${signal} — shutting down gracefully…`);
    try {
      if (dashboardServer) {
        await new Promise((r) => dashboardServer.close(() => r()));
      }
      client.destroy();
      await db.sequelize.close();
    } catch (err) {
      logger.error('Error during shutdown:', err);
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // ---- Dashboard --------------------------------------------------------
  // Started once the gateway is ready so `client.guilds.cache` is populated.
  let dashboardServer = null;
  client.once('clientReady', () => {
    try {
      dashboardServer = startDashboard(client);
    } catch (err) {
      logger.error('[dashboard] Failed to start:', err);
    }
  });

  // ---- Log in ------------------------------------------------------------
  try {
    await client.login(config.discord.token);
  } catch (err) {
    logger.error('Failed to log in to Discord:', err);
    logger.error(
      'If this is a "disallowed intents" error, enable the "Server Members Intent" ' +
        'for your application in the Discord Developer Portal.'
    );
    process.exit(1);
  }
}

main();
