'use strict';

/**
 * MEE6-style welcome card renderer.
 *
 * Composes a rectangular PNG that shows the joining member's avatar (circular),
 * a customisable title line and a subtitle (typically the member count) over
 * an optional background image. Uses `@napi-rs/canvas` — the same dependency
 * the image captcha uses — so no additional native module is required.
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

/** Reject anything that isn't a plain http/https URL to a public host. */
function isSafePublicUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  // Block obvious SSRF targets — private ranges + link-local.
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('169.254.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return false;
  }
  return true;
}

function normalizeColor(input, fallback) {
  if (!input || typeof input !== 'string') return fallback;
  const trimmed = input.trim();
  if (!trimmed) return fallback;
  // Accept "#fff", "#ffffff", "fff", "ffffff", "rgb(...)".
  if (/^#?[0-9a-f]{3}$/i.test(trimmed) || /^#?[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  }
  return fallback;
}

/** Draw a rounded-rectangle path. */
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

/** Break text at the widest word boundary that still fits in `maxWidth`. */
function fitText(ctx, text, maxWidth) {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && ctx.measureText(`${truncated}…`).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

/**
 * Render the welcome card for a member.
 * @param {import('discord.js').GuildMember} member
 * @param {object} settings A GuildSettings row (may be a Sequelize instance or .toJSON()).
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

  // ---- Background -----------------------------------------------------
  let drewBackground = false;
  if (isSafePublicUrl(cfg.welcomeCardBackgroundUrl)) {
    try {
      const img = await canvasLib.loadImage(cfg.welcomeCardBackgroundUrl);
      // Cover-fit the image (crop overflow to keep aspect ratio).
      const scale = Math.max(CARD_WIDTH / img.width, CARD_HEIGHT / img.height);
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      ctx.drawImage(img, (CARD_WIDTH - drawW) / 2, (CARD_HEIGHT - drawH) / 2, drawW, drawH);
      drewBackground = true;
    } catch (err) {
      logger.debug(`welcome-card: background load failed (${cfg.welcomeCardBackgroundUrl}): ${err.message}`);
    }
  }

  if (!drewBackground) {
    // Gradient fallback derived from the accent colour.
    const gradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
    gradient.addColorStop(0, '#1e2130');
    gradient.addColorStop(1, accentColor);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  }

  // Dark translucent overlay for text legibility on any background.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // ---- Avatar (circular with accent ring) -----------------------------
  const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256 });
  try {
    const avatar = await canvasLib.loadImage(avatarUrl);
    const cx = AVATAR_LEFT + AVATAR_SIZE / 2;
    const cy = AVATAR_TOP + AVATAR_SIZE / 2;
    // Accent ring
    ctx.beginPath();
    ctx.arc(cx, cy, AVATAR_SIZE / 2 + 6, 0, Math.PI * 2);
    ctx.fillStyle = accentColor;
    ctx.fill();
    // Circular clip and draw
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, AVATAR_LEFT, AVATAR_TOP, AVATAR_SIZE, AVATAR_SIZE);
    ctx.restore();
  } catch (err) {
    logger.debug(`welcome-card: could not load avatar for ${member.user.tag}: ${err.message}`);
    // Draw a filled circle as a fallback so the layout doesn't look empty.
    const cx = AVATAR_LEFT + AVATAR_SIZE / 2;
    const cy = AVATAR_TOP + AVATAR_SIZE / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.fillStyle = accentColor;
    ctx.fill();
  }

  // ---- Text -----------------------------------------------------------
  const textLeft = AVATAR_LEFT + AVATAR_SIZE + 40;
  const textMaxWidth = CARD_WIDTH - textLeft - 40;

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = titleColor;
  ctx.font = `bold 42px "${cardFont}"`;
  const title = fitText(ctx, titleText, textMaxWidth);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 8;
  ctx.fillText(title, textLeft, CARD_HEIGHT / 2 + 6);

  ctx.fillStyle = subtitleColor;
  ctx.font = `500 28px "${cardFont}"`;
  const subtitle = fitText(ctx, subtitleText, textMaxWidth);
  ctx.fillText(subtitle, textLeft, CARD_HEIGHT / 2 + 56);
  ctx.shadowBlur = 0;

  // Small accent pill under the subtitle for visual polish.
  const pillY = CARD_HEIGHT / 2 + 74;
  roundedRect(ctx, textLeft, pillY, 60, 6, 3);
  ctx.fillStyle = accentColor;
  ctx.fill();

  return canvas.toBuffer('image/png');
}

module.exports = {
  renderWelcomeCard,
  isSafePublicUrl,
  hasCanvas: Boolean(canvasLib && cardFont),
};
