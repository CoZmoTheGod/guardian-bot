'use strict';

const { DataTypes } = require('sequelize');

/**
 * Remembers the previous @everyone "Send Messages" permission state for a
 * channel that was locked, so /unlock can restore it exactly.
 * previous: 'allow' | 'deny' | 'neutral'
 */
module.exports = (sequelize) => {
  return sequelize.define(
    'ChannelLock',
    {
      channelId: { type: DataTypes.STRING, primaryKey: true },
      guildId: { type: DataTypes.STRING, allowNull: false },
      previous: { type: DataTypes.STRING, allowNull: false, defaultValue: 'neutral' },
      lockedBy: { type: DataTypes.STRING, allowNull: true },
      reason: { type: DataTypes.TEXT, allowNull: true },
    },
    { tableName: 'channel_locks' }
  );
};
