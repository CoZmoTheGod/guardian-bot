'use strict';

const { DataTypes } = require('sequelize');

/**
 * A named, full-server snapshot (roles, channels, overwrites, emoji) stored as
 * JSON. Multiple named backups per guild are supported.
 */
module.exports = (sequelize) => {
  return sequelize.define(
    'Backup',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      guildId: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      createdBy: { type: DataTypes.STRING, allowNull: true },
      // Full snapshot payload. DataTypes.JSON is stored as TEXT on SQLite and
      // as native JSON on PostgreSQL — transparent to us.
      data: { type: DataTypes.JSON, allowNull: false },
    },
    {
      tableName: 'backups',
      indexes: [{ unique: true, fields: ['guildId', 'name'] }],
    }
  );
};
