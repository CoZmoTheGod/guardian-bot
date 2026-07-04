'use strict';

const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../../modules/music/MusicManager');
const { embeds, replyError, COLORS } = require('../../utils/embeds');
const { formatDuration } = require('../../utils/time');

const LOOP_LABEL = { off: 'Off', track: '🔂 Track', queue: '🔁 Queue' };

module.exports = {
  data: new SlashCommandBuilder().setName('queue').setDescription('Show the current music queue.'),
  async execute(interaction) {
    const player = musicManager.get(interaction.guild);
    if (!player || !player.current) {
      return replyError(interaction, 'Nothing playing', 'There is nothing playing right now.');
    }

    const upcoming = player.queue.slice(0, 10);
    const totalSeconds =
      (player.current.duration || 0) + player.queue.reduce((sum, t) => sum + (t.duration || 0), 0);

    const lines = upcoming.map(
      (t, i) => `**${i + 1}.** [${t.title}](${t.url ?? 'https://youtube.com'}) — \`${formatDuration(t.duration)}\``
    );
    const remaining = player.queue.length - upcoming.length;

    const embed = embeds
      .plain(COLORS.music)
      .setTitle('🎵 Music Queue')
      .setDescription(
        `**Now playing:** [${player.current.title}](${player.current.url}) — \`${formatDuration(
          player.current.duration
        )}\`\n\n` + (lines.length ? lines.join('\n') : '_No tracks queued._') +
          (remaining > 0 ? `\n\n…and **${remaining}** more.` : '')
      )
      .addFields(
        { name: 'In queue', value: String(player.queue.length), inline: true },
        { name: 'Total length', value: formatDuration(totalSeconds), inline: true },
        { name: 'Loop', value: LOOP_LABEL[player.loop], inline: true },
        { name: 'Volume', value: `${player.volume}%`, inline: true },
        { name: 'SponsorBlock', value: player.sponsorBlockEnabled ? 'On' : 'Off', inline: true }
      );

    return interaction.reply({ embeds: [embed] });
  },
};
