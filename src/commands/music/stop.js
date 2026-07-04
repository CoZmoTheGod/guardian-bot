'use strict';

const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../../modules/music/MusicManager');
const { embeds, replyError } = require('../../utils/embeds');
const { isDj } = require('../../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback, clear the queue and leave the voice channel.'),
  async execute(interaction) {
    const player = musicManager.get(interaction.guild);
    if (!player) {
      return replyError(interaction, 'Not connected', 'I am not playing anything.');
    }
    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel || voiceChannel.id !== player.voiceChannelId) {
      return replyError(interaction, 'Wrong channel', 'You must be in the same voice channel as me.');
    }
    if (!(await isDj(interaction.member))) {
      return replyError(interaction, 'DJ only', 'You need the DJ role to control music.');
    }
    player.stop();
    return interaction.reply({ embeds: [embeds.success('Stopped', 'Cleared the queue and left the channel.')] });
  },
};
