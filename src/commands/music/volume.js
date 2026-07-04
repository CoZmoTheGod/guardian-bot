'use strict';

const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../../modules/music/MusicManager');
const { embeds, replyError } = require('../../utils/embeds');
const { isDj } = require('../../utils/permissions');
const { updateGuildSettings } = require('../../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set playback volume (0-200%).')
    .addIntegerOption((o) =>
      o.setName('percent').setDescription('Volume from 0 to 200').setRequired(true).setMinValue(0).setMaxValue(200)
    )
    .addBooleanOption((o) =>
      o.setName('save').setDescription('Also save this as the server default volume')
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
    const percent = interaction.options.getInteger('percent', true);
    const applied = player.setVolume(percent);

    let extra = '';
    if (interaction.options.getBoolean('save')) {
      await updateGuildSettings(interaction.guild.id, { musicDefaultVolume: applied });
      extra = ' (saved as server default)';
    }
    return interaction.reply({ embeds: [embeds.success('Volume set', `Volume is now **${applied}%**${extra}.`)] });
  },
};
