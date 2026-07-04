'use strict';

const { Events } = require('discord.js');
const { logger } = require('../logger');
const { replyError } = require('../utils/embeds');
const verification = require('../modules/security/verification');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    try {
      // ---- Verification button / modal (can occur in DMs too) ----------
      if (interaction.isButton() && interaction.customId.startsWith('verify:')) {
        return await verification.handleButton(interaction);
      }
      if (interaction.isModalSubmit() && interaction.customId.startsWith('verify:')) {
        return await verification.handleModal(interaction);
      }

      // Other component interactions (e.g. backup confirm buttons) are handled
      // by their own collectors inside the originating command — ignore here.
      if (!interaction.isChatInputCommand()) return;

      if (!interaction.inGuild()) {
        return interaction.reply({ content: 'Guardian commands can only be used inside a server.', ephemeral: true });
      }

      const command = client.commands.get(interaction.commandName);
      if (!command) {
        logger.warn(`Received unknown command: /${interaction.commandName}`);
        return;
      }

      logger.debug(`/${interaction.commandName} by ${interaction.user.tag} in ${interaction.guild?.name ?? 'DM'}`);
      await command.execute(interaction, client);
    } catch (err) {
      logger.error(`Interaction handler error (${interaction.commandName || interaction.customId || 'unknown'}):`, err);
      if (interaction.isRepliable?.()) {
        await replyError(interaction, 'Something went wrong', 'An unexpected error occurred. Please try again.').catch(() => {});
      }
    }
  },
};
