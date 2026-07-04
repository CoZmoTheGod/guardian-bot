'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const musicManager = require('../../modules/music/MusicManager');
const { resolveQuery } = require('../../modules/music/resolver');
const { embeds, replyError } = require('../../utils/embeds');
const { formatDuration } = require('../../utils/time');
const { logger } = require('../../logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a track/playlist from YouTube or Spotify (link or search text).')
    .addStringOption((o) =>
      o.setName('query').setDescription('YouTube/Spotify link or search text').setRequired(true)
    ),

  async execute(interaction) {
    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel) {
      return replyError(interaction, 'Join a voice channel', 'You must be in a voice channel to play music.');
    }

    const me = interaction.guild.members.me;
    const perms = voiceChannel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.Connect) || !perms?.has(PermissionFlagsBits.Speak)) {
      return replyError(
        interaction,
        'Missing permissions',
        'I need permission to **Connect** and **Speak** in your voice channel.'
      );
    }

    await interaction.deferReply();
    const query = interaction.options.getString('query', true);

    let resolved;
    try {
      resolved = await resolveQuery(query, { id: interaction.user.id, tag: interaction.user.tag });
    } catch (err) {
      logger.debug(`play resolve failed: ${err.message}`);
      return replyError(interaction, 'Could not resolve that', err.message);
    }

    const player = musicManager.getOrCreate(interaction.guild);
    try {
      await player.connect(voiceChannel, interaction.channel);
    } catch (err) {
      return replyError(interaction, 'Connection failed', err.message);
    }

    const wasIdle = !player.current;
    player.enqueue(resolved.tracks);
    await player.start();

    if (resolved.tracks.length > 1) {
      const total = resolved.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
      return interaction.editReply({
        embeds: [
          embeds.success(
            'Queued playlist',
            `Added **${resolved.tracks.length}** tracks` +
              `${resolved.playlistName ? ` from **${resolved.playlistName}**` : ''}` +
              ` (\`${formatDuration(total)}\`) to the queue.`
          ),
        ],
      });
    }

    const t = resolved.tracks[0];
    return interaction.editReply({
      embeds: [
        embeds.success(
          wasIdle ? 'Now playing' : 'Added to queue',
          `**${t.title}** — \`${formatDuration(t.duration)}\``
        ),
      ],
    });
  },
};
