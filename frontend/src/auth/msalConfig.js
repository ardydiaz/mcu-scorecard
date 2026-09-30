import { LogLevel } from '@azure/msal-browser';

const clientId = import.meta.env.VITE_AZURE_CLIENT_ID;
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID;

if (!clientId || !tenantId) {
  throw new Error('VITE_AZURE_CLIENT_ID and VITE_AZURE_TENANT_ID must be set in frontend/.env');
}

// MSAL (Microsoft Authentication Library) configuration.
// redirectUri must be registered in Entra ID under "Single-page application".
export const msalConfig = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'sessionStorage',
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
      piiLoggingEnabled: false,
      loggerCallback: (level, message) => {
        if (level === LogLevel.Error) console.error(message);
        else if (level === LogLevel.Warning) console.warn(message);
      },
    },
  },
};

// Scopes requested at sign-in; the resulting ID token is what the backend validates
export const loginRequest = {
  scopes: ['openid', 'profile', 'email', 'User.Read'],
};

export const appConfig = {
  apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:5005/api',
  tokenStorageKey: 'mcu_scorecard_token',
};
