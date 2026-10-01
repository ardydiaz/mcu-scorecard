const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Microsoft 365 profile photo of a user (120×120 JPEG from Graph), copied at sign-in and user sync
// so pages don't call Graph for every avatar. `data` is NULL when the user has no photo in M365.
// `checkedAt` is when Graph was last asked, so missing photos are re-checked now and then.
const UserPhoto = sequelize.define('UserPhoto', {
  userId: { type: DataTypes.INTEGER, primaryKey: true },
  data: { type: DataTypes.BLOB('medium'), allowNull: true },
  contentType: { type: DataTypes.STRING(50), allowNull: true },
  checkedAt: { type: DataTypes.DATE, allowNull: false },
}, {
  tableName: 'user_photos',
  createdAt: false,
});

module.exports = UserPhoto;
