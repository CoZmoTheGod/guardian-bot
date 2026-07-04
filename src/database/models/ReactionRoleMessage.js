'use strict';

const { DataTypes } = require('sequelize');

/**
 * A reaction-role panel message. Multiple panels per guild are supported.
 * exclusive = true means a user may only hold one role from this panel at a
 * time (selecting another swaps it).
 */
module.exports = (sequelize) => {
  return sequelize.define(
    'ReactionRoleMessage',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      guildId: { type: DataTypes.STRING, allowNull: false },
      channelId: { type: DataTypes.STRING, allowNull: false },
      messageId: { type: DataTypes.STRING, allowNull: false, unique: true },
      title: { type: DataTypes.TEXT, allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      exclusive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    { tableName: 'reaction_role_messages' }
  );
};
