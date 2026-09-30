import { PublicClientApplication } from '@azure/msal-browser';
import { appConfig, loginRequest, msalConfig } from './msalConfig';

export const msalInstance = new PublicClientApplication(msalConfig);

function currentAccount() {
  return msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0] || null;
}

// Must run before the app renders. Returns the sign-in result when the browser
// has just come back from Microsoft, otherwise null.
export async function initializeMsal() {
  await msalInstance.initialize();
  const result = await msalInstance.handleRedirectPromise();
  const account = result?.account || currentAccount();
  if (account) msalInstance.setActiveAccount(account);
  return result;
}

// Sends the browser to Microsoft sign-in; `returnTo` comes back as result.state
export function signInWithMicrosoft(returnTo = '/dashboard') {
  return msalInstance.loginRedirect({ ...loginRequest, state: returnTo });
}

// Gets a fresh ID token without a redirect if the user already has a Microsoft
// session in this tab; returns null when interactive sign-in is needed.
export async function getMicrosoftIdTokenSilently() {
  const account = currentAccount();
  if (!account) return null;
  try {
    const result = await msalInstance.acquireTokenSilent({ ...loginRequest, account, forceRefresh: true });
    return result.idToken;
  } catch {
    return null;
  }
}

export function signOutOfMicrosoft() {
  return msalInstance.logoutRedirect({ account: currentAccount() });
}

// Application JWT issued by our backend
export function getToken() {
  try {
    return localStorage.getItem(appConfig.tokenStorageKey);
  } catch {
    return null;
  }
}

export function setToken(token) {
  localStorage.setItem(appConfig.tokenStorageKey, token);
}

export function clearToken() {
  try {
    localStorage.removeItem(appConfig.tokenStorageKey);
  } catch {
    // storage unavailable; nothing to clear
  }
}

// True when the JWT's exp claim is in the past (or the token is malformed)
export function isTokenExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return !payload.exp || payload.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}
