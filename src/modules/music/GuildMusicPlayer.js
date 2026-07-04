'use strict';

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  StreamType,
  entersState,
} = require('@discordjs/voice');
const prism = require('prism-media');
const youtubedl = require('./ytdlp');
const { EmbedBuilder } = require('discord.js');
const { logger } = require('../../logger');
const { getGuildSettings } = require('../../database');
const { COLORS } = require('../../utils/embeds');
const { formatDuration } = require('../../utils/time');
const youtube = require('./youtube');
const sponsorblock = require('./sponsorblock');

const IDLE_DISCONNECT_MS = 5 * 60 * 1000; // leave after 5 min of inactivity

/**
 * Per-guild music player: owns the voice connection, audio player, queue and
 * SponsorBlock auto-skip logic for a single guild.
 */
class GuildMusicPlayer {
  constructor(guild, manager) {
    this.guild = guild;
    this.manager = manager;

    this.queue = [];
    this.current = null;
    this.currentResource = null;

    this.connection = null;
    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    this.textChannel = null;
    this.voiceChannelId = null;

    this.volume = 100;
    this.loop = 'off'; // off | track | queue
    this.sponsorBlockEnabled = true;

    this.segments = [];
    this.seekOffset = 0; // seconds skipped past, for accurate position reporting
    this.seeking = false; // true while intentionally replacing the resource
    this._skipRequested = false;

    this.sbInterval = null;
    this.idleTimer = null;
    this.destroyed = false;

    this._wirePlayer();
  }

  _wirePlayer() {
    this.player.on('stateChange', (oldState, newState) => {
      logger.debug(`[music] player ${oldState.status} -> ${newState.status} (guild ${this.guild.id})`);
    });
    this.player.on(AudioPlayerStatus.Idle, () => {
      if (this.seeking || this.destroyed) return;
      this._clearSbInterval();
      this._handleTrackEnd().catch((e) => logger.error('music track-end:', e));
    });
    this.player.on('error', (error) => {
      logger.error(`Audio player error (guild ${this.guild.id}): ${error.message}`);
      if (this.seeking || this.destroyed) return;
      this._clearSbInterval();
      this._announce(`⚠️ Playback error on **${this.current?.title ?? 'track'}**, skipping.`);
      this._handleTrackEnd().catch((e) => logger.error('music error->next:', e));
    });
  }

  // ---- Connection -------------------------------------------------------
  async connect(voiceChannel, textChannel) {
    if (textChannel) this.textChannel = textChannel;
    this.voiceChannelId = voiceChannel.id;

    const settings = await getGuildSettings(this.guild.id);
    this.volume = settings.musicDefaultVolume ?? 100;
    this.sponsorBlockEnabled = settings.sponsorBlockEnabled ?? true;

    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      return this.connection;
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: this.guild.id,
      adapterCreator: this.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    connection.subscribe(this.player);

    connection.on('stateChange', (oldState, newState) => {
      logger.debug(`[music] connection ${oldState.status} -> ${newState.status} (guild ${this.guild.id})`);
    });
    connection.on('error', (err) => logger.error(`[music] voice connection error: ${err.message}`));

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch {
        this.destroy();
      }
    });

    this.connection = connection;
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20000);
    } catch {
      this.destroy();
      throw new Error('Could not connect to the voice channel in time.');
    }
    return connection;
  }

  // ---- Queue ------------------------------------------------------------
  enqueue(tracks) {
    const arr = Array.isArray(tracks) ? tracks : [tracks];
    this.queue.push(...arr);
  }

  get isPlaying() {
    const s = this.player.state.status;
    return s === AudioPlayerStatus.Playing || s === AudioPlayerStatus.Buffering;
  }

  get isPaused() {
    return this.player.state.status === AudioPlayerStatus.Paused;
  }

  get positionSeconds() {
    const ms =
      this.player.state.status !== AudioPlayerStatus.Idle && this.player.state.resource
        ? this.player.state.resource.playbackDuration
        : 0;
    return this.seekOffset + ms / 1000;
  }

  async start() {
    if (this.current) return;
    await this._playNext();
  }

  async _playNext() {
    this._cancelIdleTimer();
    if (this.queue.length === 0) {
      this.current = null;
      this._announce('⏹️ Queue finished. I will leave the channel if nothing is queued soon.');
      this._scheduleIdleDisconnect();
      return;
    }
    const next = this.queue.shift();
    await this._startTrack(next);
  }

  async _handleTrackEnd() {
    const finished = this.current;
    const skipped = this._skipRequested;
    this._skipRequested = false;

    if (this.loop === 'track' && finished && !skipped) {
      await this._startTrack(finished);
      return;
    }
    if (this.loop === 'queue' && finished) {
      this.queue.push(finished);
    }
    this.current = null;
    await this._playNext();
  }

  async _ensureStreamable(track) {
    if (track.url && track.youtubeId) return;
    if (!track.url && track.searchQuery) {
      const found = await youtube.searchOne(track.searchQuery);
      if (!found) throw new Error(`No YouTube match found for "${track.searchQuery}".`);
      track.url = found.url;
      track.youtubeId = found.id;
      if (!track.duration && found.durationInSec) track.duration = found.durationInSec;
      if (!track.thumbnail && found.thumbnail) track.thumbnail = found.thumbnail;
    }
  }

  async _stream(track, seekSeconds) {
    const resource = this._buildResource(track, seekSeconds);
    if (resource.volume) resource.volume.setVolume(this.volume / 100);
    this.currentResource = resource;
    this.seekOffset = seekSeconds || 0;
    this.player.play(resource);
  }

  /**
   * Build a PCM audio resource by streaming the track through yt-dlp and
   * transcoding with ffmpeg. yt-dlp is used because play-dl / ytdl-core are
   * routinely broken by YouTube player changes. Forward seeking (used by
   * SponsorBlock) is handled by ffmpeg's -ss on the piped input.
   */
  _buildResource(track, seekSeconds) {
    this._destroyStreams();

    logger.debug(`[music] yt-dlp spawn for ${track.url} (seek=${seekSeconds || 0})`);
    const subprocess = youtubedl.exec(
      track.url,
      {
        output: '-',
        format: 'bestaudio[ext=webm]/bestaudio/best',
        quiet: true,
        noWarnings: true,
        noPlaylist: true,
      },
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    // Prevent an unhandled rejection when we kill the process on skip/stop.
    if (typeof subprocess.catch === 'function') subprocess.catch(() => {});

    let ytErr = '';
    subprocess.stderr?.on('data', (d) => {
      ytErr += d.toString();
    });
    subprocess.on('error', (e) => logger.error(`[music] yt-dlp spawn error: ${e.message}`));
    subprocess.on('close', (code) => {
      logger.debug(`[music] yt-dlp exited code=${code}`);
      if (code && code !== 0 && ytErr.trim()) {
        logger.error(`[music] yt-dlp stderr: ${ytErr.trim().split('\n').slice(-4).join(' | ')}`);
      }
    });

    const args = ['-analyzeduration', '0', '-loglevel', '0'];
    if (seekSeconds > 0) args.push('-ss', String(seekSeconds));
    args.push('-i', 'pipe:0', '-f', 's16le', '-ar', '48000', '-ac', '2');
    const transcoder = new prism.FFmpeg({ args });

    subprocess.stdout.on('error', () => {});
    transcoder.on('error', (err) => logger.debug(`[music] ffmpeg transcoder: ${err.message}`));
    const pcm = subprocess.stdout.pipe(transcoder);

    this._ytProcess = subprocess;
    this._transcoder = transcoder;

    return createAudioResource(pcm, { inputType: StreamType.Raw, inlineVolume: true });
  }

  _destroyStreams() {
    try {
      this._ytProcess?.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    try {
      this._transcoder?.destroy();
    } catch {
      /* ignore */
    }
    this._ytProcess = null;
    this._transcoder = null;
  }

  async _startTrack(track) {
    this.current = track;
    try {
      await this._ensureStreamable(track);
      await this._stream(track, 0);
    } catch (err) {
      logger.error(`Failed to start track "${track.title}": ${err.message}`);
      this._announce(`⚠️ Couldn't play **${track.title}** (${err.message}). Skipping.`);
      this.current = null;
      await this._playNext();
      return;
    }

    this._announce(null, this._nowPlayingEmbed(track));

    // ---- SponsorBlock ----
    this._clearSbInterval();
    this.segments = [];
    if (this.sponsorBlockEnabled && track.youtubeId) {
      this.segments = await sponsorblock.getSegments(track.youtubeId);
      if (this.segments.length) {
        logger.debug(`SponsorBlock: ${this.segments.length} segment(s) for ${track.youtubeId}`);
        this._startSbWatcher();
      }
    }
  }

  _startSbWatcher() {
    this.sbInterval = setInterval(() => {
      if (this.destroyed || !this.current || this.seeking) return;
      const pos = this.positionSeconds;
      const seg = this.segments.find((s) => pos >= s.start - 0.3 && pos < s.end - 0.5);
      if (seg) {
        logger.debug(`SponsorBlock: skipping ${seg.category} [${seg.start}s-${seg.end}s]`);
        this._seekTo(seg.end + 0.2).catch((e) => logger.error('SponsorBlock seek failed:', e));
      }
    }, 1000);
  }

  async _seekTo(seconds) {
    if (!this.current) return;
    this.seeking = true;
    try {
      await this._stream(this.current, seconds);
    } catch (err) {
      logger.error(`Seek failed: ${err.message}`);
    } finally {
      setTimeout(() => {
        this.seeking = false;
      }, 750);
    }
  }

  // ---- Controls ---------------------------------------------------------
  skip() {
    if (!this.current) return false;
    this._skipRequested = true;
    this.player.stop(true);
    return true;
  }

  pause() {
    return this.player.pause(true);
  }

  resume() {
    return this.player.unpause();
  }

  setVolume(percent) {
    this.volume = Math.max(0, Math.min(200, Math.round(percent)));
    if (this.currentResource?.volume) this.currentResource.volume.setVolume(this.volume / 100);
    return this.volume;
  }

  setLoop(mode) {
    this.loop = ['off', 'track', 'queue'].includes(mode) ? mode : 'off';
    return this.loop;
  }

  shuffle() {
    for (let i = this.queue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
  }

  stop() {
    this.queue = [];
    this.loop = 'off';
    this.current = null;
    this.destroy();
  }

  // ---- Idle handling ----------------------------------------------------
  _scheduleIdleDisconnect() {
    this._cancelIdleTimer();
    this.idleTimer = setTimeout(() => {
      if (!this.current && this.queue.length === 0) {
        this._announce('👋 Left the voice channel due to inactivity.');
        this.destroy();
      }
    }, IDLE_DISCONNECT_MS);
  }

  _cancelIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  _clearSbInterval() {
    if (this.sbInterval) {
      clearInterval(this.sbInterval);
      this.sbInterval = null;
    }
  }

  // ---- Presentation -----------------------------------------------------
  _nowPlayingEmbed(track) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.music)
      .setTitle('🎶 Now Playing')
      .setDescription(`**[${track.title}](${track.url})**`)
      .addFields(
        { name: 'Duration', value: formatDuration(track.duration), inline: true },
        {
          name: 'Requested by',
          value: track.requestedBy ? `<@${track.requestedBy.id}>` : 'Unknown',
          inline: true,
        },
        { name: 'Source', value: track.source === 'spotify' ? 'Spotify → YouTube' : 'YouTube', inline: true }
      );
    if (track.thumbnail) embed.setThumbnail(track.thumbnail);
    if (this.sponsorBlockEnabled) embed.setFooter({ text: 'SponsorBlock auto-skip enabled' });
    return embed;
  }

  _announce(content, embed) {
    if (!this.textChannel) return;
    const payload = {};
    if (content) payload.content = content;
    if (embed) payload.embeds = [embed];
    if (!payload.content && !payload.embeds) return;
    this.textChannel.send(payload).catch(() => {});
  }

  // ---- Teardown ---------------------------------------------------------
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._clearSbInterval();
    this._cancelIdleTimer();
    this.queue = [];
    this.current = null;
    this.currentResource = null;
    this._destroyStreams();
    try {
      this.player.stop(true);
    } catch {
      /* ignore */
    }
    try {
      if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
        this.connection.destroy();
      }
    } catch {
      /* ignore */
    }
    this.manager.delete(this.guild.id);
  }
}

module.exports = GuildMusicPlayer;
