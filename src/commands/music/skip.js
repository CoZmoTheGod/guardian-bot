'use strict';

const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../../modules/music/MusicManager');
const { embeds, replyError } = require('../../utils/embeds');
const { isDj } = require('../../utils/permissions');

/** Shared guard: ensure there is an active player and the user is with the bot. */
async function guard(interaction) {
  const player = musicManager.get(interaction.guild);
  if (!player || !player.current) {
    await replyError(interaction, 'Nothing playing', 'There is nothing playing right now.');
    return null;
  }
  const voiceChannel = interaction.member.voice?.channel;
  if (!voiceChannel || voiceChannel.id !== player.voiceChannelId) {
    await replyError(interaction, 'Wrong channel', 'You must be in the same voice channel as me.');
    return null;
  }
  if (!(await isDj(interaction.member))) {
    await replyError(interaction, 'DJ only', 'You need the DJ role to control music.');
    return null;
  }
  return player;
}

module.exports = {
  guard,
  data: new SlashCommandBuilder().setName('skip').setDescription('Skip the current track.'),
  async execute(interaction) {
    const player = await guard(interaction);
    if (!player) return;
    const title = player.current.title;
    player.skip();
    return interaction.reply({ embeds: [embeds.success('Skipped', `Skipped **${title}**.`)] });
  },
};
