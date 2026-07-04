'use strict';

const { REST, Routes } = require('discord.js');
const { config } = require('./config');
const { logger } = require('./logger');
const { getCommandData } = require('./loaders');

/**
 * Register slash commands with Discord.
 *
 * In development (NODE_ENV=development) with a GUILD_ID set, commands are
 * registered to that single guild so they update INSTANTLY. Otherwise they are
 * registered globally (which can take up to an hour to propagate).
 *
 * @param {object} [opts]
 * @param {string} [opts.clientId] Application id (defaults to config.discord.clientId).
 * @param {boolean} [opts.forceGlobal] Force global registration regardless of env.
 */
async function registerCommands({ clientId, forceGlobal = false } = {}) {
  const token = config.discord.token;
  const appId = clientId || config.discord.clientId;
  if (!token) throw new Error('DISCORD_TOKEN is required to register commands.');
  if (!appId) throw new Error('CLIENT_ID is required to register commands (set it in your env file).');

  const commands = getCommandData();
  const rest = new REST({ version: '10' }).setToken(token);

  const useGuild = !forceGlobal && config.isDevelopment && Boolean(config.discord.devGuildId);
  if (useGuild) {
    await rest.put(Routes.applicationGuildCommands(appId, config.discord.devGuildId), { body: commands });
    logger.info(
      `Registered ${commands.length} command(s) to dev guild ${config.discord.devGuildId} (instant update).`
    );
  } else {
    await rest.put(Routes.applicationCommands(appId), { body: commands });
    logger.info(`Registered ${commands.length} global command(s) (up to ~1h to propagate).`);
  }

  return commands.length;
}

module.exports = { registerCommands };
