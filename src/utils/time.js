'use strict';

/** Format a duration in seconds as H:MM:SS or M:SS. Live streams -> "LIVE". */
function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return 'LIVE';
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor((totalSeconds / 60) % 60);
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Build a simple text progress bar for now-playing displays. */
function progressBar(current, total, size = 20) {
  if (!Number.isFinite(total) || total <= 0) return '🔴 LIVE';
  const ratio = Math.min(Math.max(current / total, 0), 1);
  const position = Math.round(size * ratio);
  return `${'▬'.repeat(position)}🔘${'▬'.repeat(Math.max(size - position, 0))}`;
}

/** Substitute {user}, {server}, {memberCount} … placeholders in a template. */
function applyPlaceholders(template, { member, guild }) {
  if (!template) return '';
  const user = member?.user ?? member;
  return template
    .replaceAll('{user}', user ? `<@${user.id}>` : '')
    .replaceAll('{user.mention}', user ? `<@${user.id}>` : '')
    .replaceAll('{user.tag}', user?.tag ?? user?.username ?? '')
    .replaceAll('{user.name}', user?.username ?? '')
    .replaceAll('{user.id}', user?.id ?? '')
    .replaceAll('{server}', guild?.name ?? '')
    .replaceAll('{memberCount}', String(guild?.memberCount ?? ''));
}

module.exports = { formatDuration, progressBar, applyPlaceholders };
