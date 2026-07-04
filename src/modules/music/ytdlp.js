'use strict';

/**
 * yt-dlp runner. play-dl and ytdl-core are frequently broken by YouTube player
 * changes, so actual audio extraction goes through yt-dlp (via youtube-dl-exec),
 * which is updated constantly.
 *
 * On hosts without Python you can point YT_DLP_PATH at a standalone yt-dlp
 * binary (e.g. yt-dlp_linux / yt-dlp.exe) and it will be used instead of the
 * bundled one.
 */

const youtubedl = require('youtube-dl-exec');
const { logger } = require('../../logger');

let runner = youtubedl;
if (process.env.YT_DLP_PATH) {
  try {
    runner = youtubedl.create(process.env.YT_DLP_PATH);
    logger.info(`Using yt-dlp binary from YT_DLP_PATH: ${process.env.YT_DLP_PATH}`);
  } catch (err) {
    logger.warn(`Failed to use YT_DLP_PATH (${err.message}); falling back to bundled yt-dlp.`);
  }
}

module.exports = runner;
