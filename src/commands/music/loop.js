'use strict';

const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../../modules/music/MusicManager');
const { embeds, replyError } = require('../../utils/embeds');
const { isDj } = require('../../utils/permissions');

const LABELS = { off: 'Off', track: 'Current track', queue: 'Whole queue' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Set the loop mode.')
    .addStringOption((o) =>
      o
        .setName('mode')
        .setDescription('What to loop')
        .setRequired(true)
        .addChoices(
          { name: 'Off', value: 'off' },
          { name: 'Current track', value: 'track' },
          { name: 'Whole queue', value: 'queue' }
        )
    ),
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
    const mode = interaction.options.getString('mode', true);
    player.setLoop(mode);
    return interaction.reply({ embeds: [embeds.success('Loop updated', `Loop mode set to **${LABELS[mode]}**.`)] });
  },
};
