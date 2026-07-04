'use strict';

const express = require('express');
const db = require('../../database');
const { logger } = require('../../logger');
const { requireGuildAccess, flash } = require('../middleware');
const { listTextChannels, listAssignableRoles, guildHeader } = require('../lib/guild-view');
const welcomeCard = require('../../modules/welcome/card');

// ---- Small parsing helpers -----------------------------------------------
const asBool = (v) => v === 'on' || v === 'true' || v === '1' || v === true;
const asStrOrNull = (v) => {
  const s = (v ?? '').toString().trim();
  return s ? s : null;
};
const asInt = (v, fallback, { min, max } = {}) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
};
const asOneOf = (v, choices, fallback) => (choices.includes(v) ? v : fallback);

/** Package everything a settings page needs so we don't repeat it 6 times. */
async function buildContext(req) {
  const settings = await db.getGuildSettings(req.guildId);
  return {
    guild: guildHeader(req.botGuild),
    channels: listTextChannels(req.botGuild),
    roles: listAssignableRoles(req.botGuild),
    settings: settings.toJSON(),
  };
}

module.exports = function createServersRouter(client) {
  const router = express.Router();
  const guildGuard = requireGuildAccess(client);

  // ---- Server list ----------------------------------------------------
  router.get('/servers', (req, res) => {
    res.render('servers', {
      title: 'Your servers',
      guilds: req.session.accessibleGuilds || [],
    });
  });

  // ---- Guild hub ------------------------------------------------------
  router.get('/servers/:guildId', guildGuard, async (req, res) => {
    const settings = await db.getGuildSettings(req.guildId);
    res.render('hub', {
      title: req.botGuild.name,
      guild: guildHeader(req.botGuild),
      settings: settings.toJSON(),
    });
  });

  // ================================================================
  // General (logging, music defaults, backup role)
  // ================================================================
  router.get('/servers/:guildId/general', guildGuard, async (req, res) => {
    const ctx = await buildContext(req);
    res.render('settings/general', { title: 'General', ...ctx });
  });

  router.post('/servers/:guildId/general', guildGuard, async (req, res) => {
    try {
      await db.updateGuildSettings(req.guildId, {
        logChannelId: asStrOrNull(req.body.logChannelId),
        musicDefaultVolume: asInt(req.body.musicDefaultVolume, 100, { min: 0, max: 200 }),
        sponsorBlockEnabled: asBool(req.body.sponsorBlockEnabled),
        djRoleId: asStrOrNull(req.body.djRoleId),
        backupPermRoleId: asStrOrNull(req.body.backupPermRoleId),
      });
      flash(req, 'success', 'General settings saved.');
    } catch (err) {
      logger.error('[dashboard] save general failed:', err);
      flash(req, 'error', 'Could not save settings. Check the log.');
    }
    res.redirect(`/servers/${req.guildId}/general`);
  });

  // ================================================================
  // Welcome / Leave / DM / Ghost-ping
  // ================================================================
  router.get('/servers/:guildId/welcome', guildGuard, async (req, res) => {
    const ctx = await buildContext(req);
    res.render('settings/welcome', { title: 'Welcome & Leave', ...ctx });
  });

  router.post('/servers/:guildId/welcome', guildGuard, async (req, res) => {
    try {
      await db.updateGuildSettings(req.guildId, {
        welcomeEnabled: asBool(req.body.welcomeEnabled),
        welcomeChannelId: asStrOrNull(req.body.welcomeChannelId),
        welcomeMessage: (req.body.welcomeMessage ?? '').toString().slice(0, 1900),
        leaveEnabled: asBool(req.body.leaveEnabled),
        leaveChannelId: asStrOrNull(req.body.leaveChannelId),
        leaveMessage: (req.body.leaveMessage ?? '').toString().slice(0, 1900),
        welcomeDmEnabled: asBool(req.body.welcomeDmEnabled),
        welcomeDmMessage: (req.body.welcomeDmMessage ?? '').toString().slice(0, 1900),
        ghostPingPrevention: asBool(req.body.ghostPingPrevention),
        welcomeCardEnabled: asBool(req.body.welcomeCardEnabled),
        welcomeCardBackgroundUrl: asStrOrNull(req.body.welcomeCardBackgroundUrl),
        welcomeCardTitle: (req.body.welcomeCardTitle ?? '{user.name} just joined the server')
          .toString()
          .slice(0, 200),
        welcomeCardSubtitle: (req.body.welcomeCardSubtitle ?? 'Member #{memberCount}')
          .toString()
          .slice(0, 200),
        welcomeCardTitleColor: asStrOrNull(req.body.welcomeCardTitleColor) || '#ffffff',
        welcomeCardSubtitleColor: asStrOrNull(req.body.welcomeCardSubtitleColor) || '#cccccc',
        welcomeCardAccentColor: asStrOrNull(req.body.welcomeCardAccentColor) || '#5865f2',
      });
      flash(req, 'success', 'Welcome settings saved.');
    } catch (err) {
      logger.error('[dashboard] save welcome failed:', err);
      flash(req, 'error', 'Could not save settings.');
    }
    res.redirect(`/servers/${req.guildId}/welcome`);
  });

  // ---- Welcome card live preview (renders using the CURRENT saved settings
  // and the logged-in user's own avatar/name so admins can iterate quickly).
  router.get('/servers/:guildId/welcome/card-preview.png', guildGuard, async (req, res) => {
    if (!welcomeCard.hasCanvas) {
      return res.status(501).type('text/plain').send('Card renderer unavailable on this server.');
    }
    try {
      const settings = await db.getGuildSettings(req.guildId);
      const sessionUser = req.session.user;
      // Fake a discord.js-shaped GuildMember for the renderer.
      const fakeMember = {
        guild: {
          name: req.botGuild.name,
          memberCount: req.botGuild.memberCount,
        },
        user: {
          id: sessionUser?.id || '0',
          username: sessionUser?.globalName || sessionUser?.username || 'PreviewUser',
          tag: sessionUser?.username || 'PreviewUser',
          displayAvatarURL: () =>
            sessionUser?.avatar
              ? `https://cdn.discordapp.com/avatars/${sessionUser.id}/${sessionUser.avatar}.png?size=256`
              : `https://cdn.discordapp.com/embed/avatars/${(Number(sessionUser?.id || 0) >> 22) % 6}.png`,
        },
      };
      const buffer = await welcomeCard.renderWelcomeCard(fakeMember, settings);
      if (!buffer) return res.status(500).type('text/plain').send('Render failed.');
      res.setHeader('Cache-Control', 'no-store');
      res.type('image/png').send(buffer);
    } catch (err) {
      logger.error('[dashboard] card preview failed:', err);
      res.status(500).type('text/plain').send('Render failed.');
    }
  });

  // ================================================================
  // Security (verification + raid)
  // ================================================================
  router.get('/servers/:guildId/security', guildGuard, async (req, res) => {
    const ctx = await buildContext(req);
    res.render('settings/security', { title: 'Security', ...ctx });
  });

  router.post('/servers/:guildId/security', guildGuard, async (req, res) => {
    try {
      await db.updateGuildSettings(req.guildId, {
        verificationEnabled: asBool(req.body.verificationEnabled),
        verificationChannelId: asStrOrNull(req.body.verificationChannelId),
        verifiedRoleId: asStrOrNull(req.body.verifiedRoleId),
        captchaMode: asOneOf(req.body.captchaMode, ['button', 'text', 'image'], 'button'),
        captchaDelivery: asOneOf(req.body.captchaDelivery, ['channel', 'dm'], 'channel'),
        verifyTimeoutSec: asInt(req.body.verifyTimeoutSec, 300, { min: 30, max: 3600 }),
        unverifiedAction: asOneOf(req.body.unverifiedAction, ['kick', 'flag'], 'kick'),
        raidModeEnabled: asBool(req.body.raidModeEnabled),
        raidJoinThreshold: asInt(req.body.raidJoinThreshold, 8, { min: 2, max: 100 }),
        raidWindowSec: asInt(req.body.raidWindowSec, 10, { min: 2, max: 300 }),
        raidAction: asOneOf(req.body.raidAction, ['alert', 'kick', 'lockdown'], 'alert'),
      });
      flash(req, 'success', 'Security settings saved.');
    } catch (err) {
      logger.error('[dashboard] save security failed:', err);
      flash(req, 'error', 'Could not save settings.');
    }
    res.redirect(`/servers/${req.guildId}/security`);
  });

  // ================================================================
  // Reaction Roles (list + delete panels; creation stays on Discord)
  // ================================================================
  router.get('/servers/:guildId/reactionroles', guildGuard, async (req, res) => {
    const ctx = await buildContext(req);
    const panels = await db.ReactionRoleMessage.findAll({
      where: { guildId: req.guildId },
      include: [{ model: db.ReactionRoleMapping, as: 'mappings' }],
      order: [['id', 'DESC']],
    });
    const rolesById = new Map(ctx.roles.map((r) => [r.id, r]));
    const channelsById = new Map(ctx.channels.map((c) => [c.id, c]));
    const view = panels.map((p) => ({
      id: p.id,
      channelId: p.channelId,
      channelName: channelsById.get(p.channelId)?.name || 'deleted-channel',
      messageId: p.messageId,
      title: p.title,
      description: p.description,
      exclusive: p.exclusive,
      mappings: (p.mappings || []).map((m) => ({
        emoji: m.emoji,
        roleId: m.roleId,
        roleName: rolesById.get(m.roleId)?.name || 'deleted-role',
      })),
      jumpUrl: `https://discord.com/channels/${req.guildId}/${p.channelId}/${p.messageId}`,
    }));
    res.render('settings/reactionroles', {
      title: 'Reaction Roles',
      ...ctx,
      panels: view,
    });
  });

  router.post('/servers/:guildId/reactionroles/panel/:panelId/delete', guildGuard, async (req, res) => {
    const panelId = Number.parseInt(req.params.panelId, 10);
    if (!Number.isFinite(panelId)) return res.redirect(`/servers/${req.guildId}/reactionroles`);
    const panel = await db.ReactionRoleMessage.findOne({ where: { id: panelId, guildId: req.guildId } });
    if (!panel) {
      flash(req, 'error', 'Panel not found.');
      return res.redirect(`/servers/${req.guildId}/reactionroles`);
    }
    try {
      // Try to delete the underlying Discord message too, best-effort.
      const channel = await req.botGuild.channels.fetch(panel.channelId).catch(() => null);
      if (channel && typeof channel.messages?.fetch === 'function') {
        const msg = await channel.messages.fetch(panel.messageId).catch(() => null);
        if (msg) await msg.delete().catch(() => null);
      }
      await db.ReactionRoleMapping.destroy({ where: { messageId: panel.messageId } });
      await panel.destroy();
      flash(req, 'success', 'Reaction-role panel deleted.');
    } catch (err) {
      logger.error('[dashboard] delete panel failed:', err);
      flash(req, 'error', 'Could not delete panel.');
    }
    res.redirect(`/servers/${req.guildId}/reactionroles`);
  });

  router.post('/servers/:guildId/reactionroles/channel', guildGuard, async (req, res) => {
    try {
      await db.updateGuildSettings(req.guildId, {
        reactRoleChannelId: asStrOrNull(req.body.reactRoleChannelId),
      });
      flash(req, 'success', 'Default reaction-role channel updated.');
    } catch (err) {
      logger.error('[dashboard] save rr channel failed:', err);
      flash(req, 'error', 'Could not save.');
    }
    res.redirect(`/servers/${req.guildId}/reactionroles`);
  });

  // ================================================================
  // Backups
  // ================================================================
  router.get('/servers/:guildId/backups', guildGuard, async (req, res) => {
    const ctx = await buildContext(req);
    const backups = await db.Backup.findAll({
      where: { guildId: req.guildId },
      attributes: ['id', 'name', 'createdBy', 'createdAt'],
      order: [['createdAt', 'DESC']],
    });
    res.render('settings/backups', {
      title: 'Backups',
      ...ctx,
      backups: backups.map((b) => b.toJSON()),
    });
  });

  router.post('/servers/:guildId/backups/:backupId/delete', guildGuard, async (req, res) => {
    const backupId = Number.parseInt(req.params.backupId, 10);
    const backup = await db.Backup.findOne({ where: { id: backupId, guildId: req.guildId } });
    if (!backup) {
      flash(req, 'error', 'Backup not found.');
    } else {
      const confirm = (req.body.confirmName ?? '').trim();
      if (confirm !== backup.name) {
        flash(req, 'error', `Type the backup name (${backup.name}) exactly to confirm deletion.`);
      } else {
        await backup.destroy();
        flash(req, 'success', `Backup "${backup.name}" deleted.`);
      }
    }
    res.redirect(`/servers/${req.guildId}/backups`);
  });

  // ================================================================
  // Moderation (locked channels)
  // ================================================================
  router.get('/servers/:guildId/moderation', guildGuard, async (req, res) => {
    const ctx = await buildContext(req);
    const locks = await db.ChannelLock.findAll({ where: { guildId: req.guildId } });
    const chanById = new Map(ctx.channels.map((c) => [c.id, c]));
    const view = locks.map((l) => ({
      channelId: l.channelId,
      channelName: chanById.get(l.channelId)?.name || 'deleted-channel',
      previous: l.previous,
      reason: l.reason,
      lockedBy: l.lockedBy,
    }));
    res.render('settings/moderation', { title: 'Moderation', ...ctx, locks: view });
  });

  // The dashboard only *records* the intent — the actual unlock is left to
  // the /unlock slash command so we don't have to duplicate all the
  // permission-restoration logic here.
  router.post('/servers/:guildId/moderation/lock/:channelId/forget', guildGuard, async (req, res) => {
    const cid = req.params.channelId;
    const lock = await db.ChannelLock.findOne({ where: { channelId: cid, guildId: req.guildId } });
    if (lock) {
      await lock.destroy();
      flash(req, 'success', 'Lock record removed. Use /unlock in Discord to restore permissions.');
    } else {
      flash(req, 'error', 'No lock record for that channel.');
    }
    res.redirect(`/servers/${req.guildId}/moderation`);
  });

  return router;
};
