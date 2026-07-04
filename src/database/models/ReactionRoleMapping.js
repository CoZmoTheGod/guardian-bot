'use strict';

const { DataTypes } = require('sequelize');

/**
 * A single emoji -> role mapping belonging to a ReactionRoleMessage.
 * emoji stores the unicode character for standard emoji, or the numeric ID for
 * custom emoji. emojiName is kept for display/logging.
 */
module.exports = (sequelize) => {
  return sequelize.define(
    'ReactionRoleMapping',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      guildId: { type: DataTypes.STRING, allowNull: false },
      messageId: { type: DataTypes.STRING, allowNull: false },
      emoji: { type: DataTypes.STRING, allowNull: false },
      emojiName: { type: DataTypes.STRING, allowNull: true },
      roleId: { type: DataTypes.STRING, allowNull: false },
    },
    {
      tableName: 'reaction_role_mappings',
      indexes: [{ fields: ['messageId'] }],
    }
  );
};
