'use strict';

const { DataTypes } = require('sequelize');

/**
 * Per-guild configuration. One row per guild; created on demand.
 * Every feature reads its settings from here so everything is configurable
 * through slash commands with no manual JSON editing.
 */
module.exports = (sequelize) => {
  return sequelize.define(
    'GuildSettings',
    {
      guildId: { type: DataTypes.STRING, primaryKey: true },

      // Central logging channel (console is always used as well).
      logChannelId: { type: DataTypes.STRING, allowNull: true },

      // ---- Music ----
      musicDefaultVolume: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
      sponsorBlockEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      djRoleId: { type: DataTypes.STRING, allowNull: true },

      // ---- Reaction roles ----
      reactRoleChannelId: { type: DataTypes.STRING, allowNull: true },

      // ---- Join / Leave ----
      welcomeEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      welcomeChannelId: { type: DataTypes.STRING, allowNull: true },
      welcomeMessage: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: 'Welcome {user} to **{server}**! You are member #{memberCount}.',
      },
      leaveEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      leaveChannelId: { type: DataTypes.STRING, allowNull: true },
      leaveMessage: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '{user.tag} has left **{server}**. We now have {memberCount} members.',
      },
      welcomeDmEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      welcomeDmMessage: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: 'Hey {user.name}, welcome to **{server}**! Please read the rules and enjoy your stay.',
      },
      // Ghost-ping detection: log messages that mentioned users/roles and were deleted.
      ghostPingPrevention: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

      // ---- Welcome card (MEE6-style rendered image) ----
      welcomeCardEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      // Supports the same {user.name} / {server} / {memberCount} placeholders as the text messages.
      welcomeCardTitle: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '{user.name} just joined the server',
      },
      welcomeCardSubtitle: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: 'Member #{memberCount}',
      },
      // Hex colours; a leading # is optional.
      welcomeCardTitleColor: { type: DataTypes.STRING, allowNull: false, defaultValue: '#ffffff' },
      welcomeCardSubtitleColor: { type: DataTypes.STRING, allowNull: false, defaultValue: '#cccccc' },
      welcomeCardAccentColor: { type: DataTypes.STRING, allowNull: false, defaultValue: '#5865f2' },

      // ---- Security / verification ----
      verificationEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      verificationChannelId: { type: DataTypes.STRING, allowNull: true },
      verifiedRoleId: { type: DataTypes.STRING, allowNull: true },
      // button | text | image
      captchaMode: { type: DataTypes.STRING, allowNull: false, defaultValue: 'button' },
      // channel | dm
      captchaDelivery: { type: DataTypes.STRING, allowNull: false, defaultValue: 'channel' },
      verifyTimeoutSec: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 300 },
      // kick | flag
      unverifiedAction: { type: DataTypes.STRING, allowNull: false, defaultValue: 'kick' },

      // ---- Raid detection ----
      raidModeEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      raidJoinThreshold: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 8 },
      raidWindowSec: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10 },
      // alert | kick | lockdown
      raidAction: { type: DataTypes.STRING, allowNull: false, defaultValue: 'alert' },

      // ---- Backup ----
      // Role allowed (besides the owner / Administrators) to run backup commands.
      backupPermRoleId: { type: DataTypes.STRING, allowNull: true },
    },
    { tableName: 'guild_settings' }
  );
};
