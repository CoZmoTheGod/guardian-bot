'use strict';

/**
 * Captcha challenge builder. Supports three modes:
 *   button — a simple "I'm human" click (fast, low friction)
 *   text   — the bot shows a random code the user must type back
 *   image  — the code is rendered as a distorted image (needs @napi-rs/canvas)
 *
 * The image renderer degrades gracefully to text mode if the canvas library
 * is unavailable, so the bot never hard-fails on install.
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} = require('discord.js');
const { COLORS } = require('../../utils/embeds');
const { logger } = require('../../logger');

let canvasLib = null;
let captchaFont = null;
try {
  // Optional native-ish dependency (ships prebuilt binaries).
  canvasLib = require('@napi-rs/canvas');
  // Pick a font family that actually exists on this system. Passing an unknown
  // family (e.g. "Sans") makes @napi-rs/canvas render broken/blank glyphs.
  const preferred = ['Arial', 'Helvetica', 'Liberation Sans', 'DejaVu Sans', 'Verdana', 'Tahoma', 'Noto Sans'];
  const available = canvasLib.GlobalFonts.families.map((f) => f.family);
  captchaFont = preferred.find((f) => available.includes(f)) || available[0] || null;
  if (!captchaFont) {
    logger.warn('@napi-rs/canvas has no usable fonts — image captcha will fall back to text.');
  }
} catch {
  logger.warn('@napi-rs/canvas not available — image captcha will fall back to text.');
}

// Unambiguous character set (no 0/O, 1/I/L).
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(length = 6) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

const rand = (min, max) => Math.random() * (max - min) + min;

/** Render the code to a PNG buffer, or null if canvas/font is unavailable. */
function createImageBuffer(code) {
  if (!canvasLib || !captchaFont) return null;
  try {
    const width = 360;
    const height = 120;
    const canvas = canvasLib.createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Light background for maximum contrast/legibility.
    ctx.fillStyle = '#eef2f7';
    ctx.fillRect(0, 0, width, height);

    // Subtle speckle noise.
    for (let i = 0; i < 140; i += 1) {
      ctx.fillStyle = `rgba(0,0,0,${rand(0.02, 0.09).toFixed(3)})`;
      ctx.fillRect(rand(0, width), rand(0, height), 2, 2);
    }

    // Characters: bold coloured fill with a light outline so they stay readable.
    const colors = ['#e63946', '#1d3557', '#2a9d8f', '#6a4c93', '#bc6c25', '#264653'];
    const startX = 42;
    const step = (width - startX * 2) / code.length;
    for (let i = 0; i < code.length; i += 1) {
      ctx.save();
      const x = startX + i * step + step / 2;
      const y = height / 2 + rand(-9, 9);
      ctx.translate(x, y);
      ctx.rotate(rand(-0.28, 0.28));
      ctx.font = `bold ${Math.round(rand(54, 64))}px "${captchaFont}"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeText(code[i], 0, 0);
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillText(code[i], 0, 0);
      ctx.restore();
    }

    // A few thin noise lines across the top.
    for (let i = 0; i < 5; i += 1) {
      ctx.strokeStyle = `rgba(0,0,0,${rand(0.15, 0.3).toFixed(2)})`;
      ctx.lineWidth = rand(1, 2);
      ctx.beginPath();
      ctx.moveTo(rand(0, width), rand(0, height));
      ctx.lineTo(rand(0, width), rand(0, height));
      ctx.stroke();
    }

    return canvas.toBuffer('image/png');
  } catch (err) {
    logger.warn(`Captcha image render failed: ${err.message}`);
    return null;
  }
}

/**
 * Build the message payload for a verification challenge.
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[], files: AttachmentBuilder[] }}
 */
function buildChallenge({ mode, guildId, userId, code, guildName, timeoutSec, test = false }) {
  const minutes = Math.max(1, Math.round(timeoutSec / 60));
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🛡️ Verification required')
    .setDescription(
      `Welcome to **${guildName}**! To gain access, please verify that you are human.\n` +
        `You have **${minutes} minute(s)** to complete verification.` +
        (test ? '\n\n*(Test preview — your roles will not change.)*' : '')
    );

  const row = new ActionRowBuilder();
  const files = [];

  if (mode === 'button') {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`verify:${test ? 'testhuman' : 'human'}:${guildId}:${userId}`)
        .setLabel("I'm human")
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
    );
  } else if (mode === 'image') {
    const buffer = createImageBuffer(code);
    if (buffer) {
      files.push(new AttachmentBuilder(buffer, { name: 'captcha.png' }));
      embed.setImage('attachment://captcha.png');
      embed.addFields({ name: 'Instructions', value: 'Click the button and type the characters from the image.' });
    } else {
      embed.addFields({ name: 'Your code', value: `\`\`\`\n${code}\n\`\`\`` });
    }
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`verify:${test ? 'testcode' : 'code'}:${guildId}:${userId}${test ? `:${code}` : ''}`)
        .setLabel('Enter code')
        .setStyle(ButtonStyle.Primary)
    );
  } else {
    // text mode (and any unknown value)
    embed.addFields({ name: 'Your code', value: `\`\`\`\n${code}\n\`\`\`` });
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`verify:${test ? 'testcode' : 'code'}:${guildId}:${userId}${test ? `:${code}` : ''}`)
        .setLabel('Enter code')
        .setStyle(ButtonStyle.Primary)
    );
  }

  return { embeds: [embed], components: [row], files };
}

module.exports = { generateCode, createImageBuffer, buildChallenge, hasCanvas: Boolean(canvasLib && captchaFont) };
