'use strict';

/** Extract an 11-character YouTube video id from any common URL form. */
function getYouTubeId(url) {
  if (!url) return null;
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

module.exports = { getYouTubeId };
