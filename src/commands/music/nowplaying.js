'use strict';

const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../../modules/music/MusicManager');
const { embeds, replyError, COLORS } = require('../../utils/embeds');
const { formatDuration, progressBar } = require('../../utils/time');

module.exports = {
  data: new SlashCommandBuilder().setName('nowplaying').setDescription('Show the currently playing track.'),
  async execute(interaction) {
    const player = musicManager.get(interaction.guild);
    if (!player || !player.current) {
      return replyError(interaction, 'Nothing playing', 'There is nothing playing right now.');
    }

    const track = player.current;
    const position = player.positionSeconds;
    const bar = progressBar(position, track.duration);

    const embed = embeds
      .plain(COLORS.music)
      .setTitle('🎧 Now Playing')
      .setDescription(`**[${track.title}](${track.url})**`)
      .addFields(
        {
          name: 'Progress',
          value: `${bar}\n\`${formatDuration(position)} / ${formatDuration(track.duration)}\``,
        },
        { name: 'Requested by', value: track.requestedBy ? `<@${track.requestedBy.id}>` : 'Unknown', inline: true },
        { name: 'State', value: player.isPaused ? '⏸️ Paused' : '▶️ Playing', inline: true },
        { name: 'Volume', value: `${player.volume}%`, inline: true }
      );
    if (track.thumbnail) embed.setThumbnail(track.thumbnail);

    return interaction.reply({ embeds: [embed] });
  },
};
