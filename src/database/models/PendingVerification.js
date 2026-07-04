'use strict';

const { DataTypes } = require('sequelize');

/**
 * A member who joined but has not yet completed captcha verification.
 * Persisted so pending checks survive restarts (a periodic sweep enforces the
 * timeout / auto-kick action).
 */
module.exports = (sequelize) => {
  return sequelize.define(
    'PendingVerification',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      guildId: { type: DataTypes.STRING, allowNull: false },
      userId: { type: DataTypes.STRING, allowNull: false },
      // For text/image captcha the expected code; null for button captcha.
      code: { type: DataTypes.STRING, allowNull: true },
      // Where the challenge was posted (channel id) and the prompt message id,
      // so we can clean it up afterwards.
      channelId: { type: DataTypes.STRING, allowNull: true },
      promptMessageId: { type: DataTypes.STRING, allowNull: true },
      deliveredViaDm: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
    },
    {
      tableName: 'pending_verifications',
      indexes: [{ unique: true, fields: ['guildId', 'userId'] }],
    }
  );
};
