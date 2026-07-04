'use strict';

/**
 * MEE6-style welcome card renderer.
 *
 * Produces a rectangular PNG entirely in memory: no files are written to
 * disk, no external images are fetched (except the joining member's avatar
 * from Discord's own CDN, which is a public asset Discord already lets our
 * bot embed). The buffer is streamed straight into `message.send({ files })`
 * and dropped as soon as Discord acknowledges the send — Discord then hosts
 * the resulting attachment on its own CDN, exactly like MEE6.
 *
 * Uses `@napi-rs/canvas` — the same dependency the image captcha already
 * pulls in — so no extra native module is required.
 */

const { logger } = require('../../logger');
const { applyPlaceholders } = require('../../utils/time');

let canvasLib = null;
let cardFont = null;
try {
  canvasLib = require('@napi-rs/canvas');
  const preferred = ['Arial', 'Helvetica', 'Liberation Sans', 'DejaVu Sans', 'Verdana', 'Tahoma', 'Noto Sans'];
  const available = canvasLib.GlobalFonts.families.map((f) => f.family);
  cardFont = preferred.find((f) => available.includes(f)) || available[0] || null;
  if (!cardFont) logger.warn('welcome-card: no usable font on system; card rendering disabled.');
} catch {
  logger.warn('welcome-card: @napi-rs/canvas not installed; card rendering disabled.');
}

const CARD_WIDTH = 900;
const CARD_HEIGHT = 300;
const AVATAR_SIZE = 180;
const AVATAR_LEFT = 60;
const AVATAR_TOP = (CARD_HEIGHT - AVATAR_SIZE) / 2;

/** Normalise "fff" / "#ffffff" / "ffffff" → "#ffffff". */
function normalizeColor(input, fallback) {
  if (!input || typeof input !== 'string') return fallback;
  const t = input.trim();
  if (!t) return fallback;
  if (/^#?[0-9a-f]{3}$/i.test(t) || /^#?[0-9a-f]{6}$/i.test(t)) {
    return t.startsWith('#') ? t : `#${t}`;
  }
  return fallback;
}

/** Parse a hex colour into [r,g,b]. */
function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Nudge a colour toward black. amount 0..1. */
function darken(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  const k = 1 - Math.max(0, Math.min(1, amount));
  return `rgb(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)})`;
}

/** Draw a rounded rectangle path. */
function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Truncate `text` with an ellipsis to fit within `maxWidth`. */
function fitText(ctx, text, maxWidth) {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/**
 * Render the welcome card for a member and return the PNG bytes. Nothing is
 * written to disk — the caller sends the buffer directly to Discord and the
 * bytes are freed as soon as the send resolves.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {object} settings A GuildSettings row (Sequelize instance or .toJSON()).
 * @returns {Promise<Buffer|null>} PNG buffer, or null if rendering is unavailable.
 */
async function renderWelcomeCard(member, settings) {
  if (!canvasLib || !cardFont) return null;
  if (!member?.user || !member?.guild) return null;

  const cfg = settings?.get?.() || settings || {};
  const guild = member.guild;

  const titleColor = normalizeColor(cfg.welcomeCardTitleColor, '#ffffff');
  const subtitleColor = normalizeColor(cfg.welcomeCardSubtitleColor, '#cccccc');
  const accentColor = normalizeColor(cfg.welcomeCardAccentColor, '#5865f2');
  const titleText = applyPlaceholders(
    cfg.welcomeCardTitle || '{user.name} just joined the server',
    { member, guild }
  );
  const subtitleText = applyPlaceholders(
    cfg.welcomeCardSubtitle || 'Member #{memberCount}',
    { member, guild }
  );

  const canvas = canvasLib.createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext('2d');

  // ---- Background: a self-contained gradient derived from the accent
  // colour plus a subtle radial glow behind the avatar. No external images.
  const bg = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  bg.addColorStop(0, '#0f1216');
  bg.addColorStop(1, darken(accentColor, 0.55));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const glowCx = AVATAR_LEFT + AVATAR_SIZE / 2;
  const glowCy = AVATAR_TOP + AVATAR_SIZE / 2;
  const glow = ctx.createRadialGradient(glowCx, glowCy, 0, glowCx, glowCy, CARD_HEIGHT);
  glow.addColorStop(0, `${accentColor}55`); // ~33% alpha
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // Subtle noise for texture.
  for (let i = 0; i < 90; i += 1) {
    ctx.fillStyle = `rgba(255,255,255,${(Math.random() * 0.05).toFixed(3)})`;
    ctx.fillRect(Math.random() * CARD_WIDTH, Math.random() * CARD_HEIGHT, 2, 2);
  }

  // ---- Avatar (circular, with accent ring). The avatar is fetched from
  // Discord's own CDN using the URL Discord already publishes for this user
  // — never persisted on our side.
  const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256 });
  try {
    const avatar = await canvasLib.loadImage(avatarUrl);
    // Accent ring
    ctx.beginPath();
    ctx.arc(glowCx, glowCy, AVATAR_SIZE / 2 + 6, 0, Math.PI * 2);
    ctx.fillStyle = accentColor;
    ctx.fill();
    // Circular clip and draw the avatar
    ctx.save();
    ctx.beginPath();
    ctx.arc(glowCx, glowCy, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, AVATAR_LEFT, AVATAR_TOP, AVATAR_SIZE, AVATAR_SIZE);
    ctx.restore();
  } catch (err) {
    logger.debug(`welcome-card: could not load avatar for ${member.user.tag}: ${err.message}`);
    ctx.beginPath();
    ctx.arc(glowCx, glowCy, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.fillStyle = accentColor;
    ctx.fill();
  }

  // ---- Text
  const textLeft = AVATAR_LEFT + AVATAR_SIZE + 40;
  const textMaxWidth = CARD_WIDTH - textLeft - 40;

  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 8;

  ctx.fillStyle = titleColor;
  ctx.font = `bold 42px "${cardFont}"`;
  ctx.fillText(fitText(ctx, titleText, textMaxWidth), textLeft, CARD_HEIGHT / 2 + 6);

  ctx.fillStyle = subtitleColor;
  ctx.font = `500 28px "${cardFont}"`;
  ctx.fillText(fitText(ctx, subtitleText, textMaxWidth), textLeft, CARD_HEIGHT / 2 + 56);
  ctx.shadowBlur = 0;

  // Small accent pill for polish.
  roundedRect(ctx, textLeft, CARD_HEIGHT / 2 + 74, 60, 6, 3);
  ctx.fillStyle = accentColor;
  ctx.fill();

  return canvas.toBuffer('image/png');
}

module.exports = { renderWelcomeCard, hasCanvas: Boolean(canvasLib && cardFont) };
