const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5005,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:6001',
  // Apply database changes when the server starts. On by default except in production, where
  // they are applied with `npm run migrate` (set AUTO_MIGRATE=true/false to override)
  autoMigrate: process.env.AUTO_MIGRATE
    ? process.env.AUTO_MIGRATE === 'true'
    : (process.env.NODE_ENV || 'development') !== 'production',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    name: process.env.DB_NAME || 'mcu_scorecard',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },

  azure: {
    tenantId: process.env.AZURE_TENANT_ID,
    clientId: process.env.AZURE_CLIENT_ID,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
  },

  excel: {
    driveId: process.env.EXCEL_DRIVE_ID,
    itemId: process.env.EXCEL_ITEM_ID,
    // Folder to look for scorecard files in; defaults to the folder that holds EXCEL_ITEM_ID
    folderId: process.env.EXCEL_FOLDER_ID || null,
  },
};

if (!env.jwt.secret) {
  throw new Error('JWT_SECRET is not set in .env');
}
if (!env.azure.tenantId || !env.azure.clientId) {
  throw new Error('AZURE_TENANT_ID and AZURE_CLIENT_ID must be set in .env (needed to validate Microsoft sign-in)');
}

module.exports = env;
