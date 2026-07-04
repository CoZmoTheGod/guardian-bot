'use strict';

const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../../modules/music/MusicManager');
const { embeds, replyError } = require('../../utils/embeds');
const { isDj } = require('../../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder().setName('resume').setDescription('Resume paused playback.'),
  async execute(interaction) {
    const player = musicManager.get(interaction.guild);
    if (!player || !player.current) {
      return replyError(interaction, 'Nothing playing', 'There is nothing playing right now.');
    }
    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel || voiceChannel.id !== player.voiceChannelId) {
      return replyError(interaction, 'Wrong channel', 'You must be in the same voice channel as me.');
    }
    if (!(await isDj(interaction.member))) {
      return replyError(interaction, 'DJ only', 'You need the DJ role to control music.');
    }
    if (!player.isPaused) {
      return replyError(interaction, 'Not paused', 'Playback is not paused.');
    }
    player.resume();
    return interaction.reply({ embeds: [embeds.success('Resumed', 'Playback resumed.')] });
  },
};
