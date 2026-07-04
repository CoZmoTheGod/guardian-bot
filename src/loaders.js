'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Collection } = require('discord.js');
const { logger } = require('./logger');

/** Recursively collect all .js files under a directory. */
function collectJsFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Load every command module into client.commands.
 * A command module exports { data: SlashCommandBuilder, execute, [autocomplete] }.
 */
function loadCommands(client) {
  client.commands = new Collection();
  const dir = path.join(__dirname, 'commands');
  let count = 0;

  for (const file of collectJsFiles(dir)) {
    const command = require(file);
    if (!command?.data?.name || typeof command.execute !== 'function') {
      logger.warn(`Skipping invalid command file: ${path.relative(__dirname, file)}`);
      continue;
    }
    client.commands.set(command.data.name, command);
    count += 1;
    logger.debug(`Loaded command /${command.data.name}`);
  }

  logger.info(`Loaded ${count} slash command(s).`);
  return client.commands;
}

/** Load every event module and bind it to the client. */
function loadEvents(client) {
  const dir = path.join(__dirname, 'events');
  let count = 0;

  for (const file of collectJsFiles(dir)) {
    const event = require(file);
    if (!event?.name || typeof event.execute !== 'function') {
      logger.warn(`Skipping invalid event file: ${path.relative(__dirname, file)}`);
      continue;
    }
    const handler = (...args) => {
      Promise.resolve(event.execute(...args, client)).catch((err) =>
        logger.error(`Error in event '${event.name}':`, err)
      );
    };
    if (event.once) client.once(event.name, handler);
    else client.on(event.name, handler);
    count += 1;
    logger.debug(`Bound event '${event.name}'${event.once ? ' (once)' : ''}`);
  }

  logger.info(`Loaded ${count} event handler(s).`);
}

/** Build the JSON payload array used to register commands with Discord. */
function getCommandData() {
  const dir = path.join(__dirname, 'commands');
  const data = [];
  for (const file of collectJsFiles(dir)) {
    const command = require(file);
    if (command?.data?.toJSON) data.push(command.data.toJSON());
  }
  return data;
}

module.exports = { loadCommands, loadEvents, getCommandData, collectJsFiles };
