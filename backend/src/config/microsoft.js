const msal = require('@azure/msal-node');
const env = require('./env');
const logger = require('../utils/logger');

const msalConfig = {
  auth: {
    clientId: env.azure.clientId,
    authority: `https://login.microsoftonline.com/${env.azure.tenantId}`,
    clientSecret: env.azure.clientSecret,
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message) => logger.debug(message),
      piiLoggingEnabled: false,
      logLevel: msal.LogLevel.Warning,
    },
  },
};

// User sign-in happens in the React app (MSAL browser); this client is only used
// app-only for Graph calls: department lookup, user sync, Excel reads.
const appScopes = ['https://graph.microsoft.com/.default'];

let msalClient;
function getMsalClient() {
  if (!msalClient) {
    if (!env.azure.clientId || !env.azure.tenantId || !env.azure.clientSecret) {
      throw new Error('Azure credentials (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET) are not set in .env');
    }
    msalClient = new msal.ConfidentialClientApplication(msalConfig);
  }
  return msalClient;
}

module.exports = { getMsalClient, appScopes };
