'use strict';

const GuildMusicPlayer = require('./GuildMusicPlayer');
const { logger } = require('../../logger');

/**
 * Global registry of per-guild music players. Also performs one-time setup of
 * the ffmpeg binary path so @discordjs/voice / prism-media can find it.
 */
class MusicManager {
  constructor() {
    this.players = new Map();
    this._initFfmpeg();
  }

  _initFfmpeg() {
    try {
      const ffmpegPath = require('ffmpeg-static');
      if (ffmpegPath && !process.env.FFMPEG_PATH) {
        process.env.FFMPEG_PATH = ffmpegPath;
        logger.debug(`Using bundled ffmpeg at ${ffmpegPath}`);
      }
    } catch (err) {
      logger.warn(`ffmpeg-static not available (${err.message}); relying on system ffmpeg.`);
    }
  }

  /** Get the existing player for a guild, or null. */
  get(guild) {
    return this.players.get(guild.id) || null;
  }

  /** Get or lazily create the player for a guild. */
  getOrCreate(guild) {
    let player = this.players.get(guild.id);
    if (!player) {
      player = new GuildMusicPlayer(guild, this);
      this.players.set(guild.id, player);
    }
    return player;
  }

  /** Remove a guild's player (called by the player on destroy). */
  delete(guildId) {
    this.players.delete(guildId);
  }
}

module.exports = new MusicManager();
