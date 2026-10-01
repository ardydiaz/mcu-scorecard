import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AuthContext from '../context/AuthContext';
import { getMe, loginWithMicrosoft, logout as logoutApi } from '../api/authApi';
import { getErrorMessage, UNAUTHORIZED_EVENT } from '../api/axios';
import {
  clearToken,
  getMicrosoftIdTokenSilently,
  getToken,
  isTokenExpired,
  setToken,
  signInWithMicrosoft,
  signOutOfMicrosoft,
} from './authService';
import { appConfig } from './msalConfig';

// redirectResult / redirectError come from MSAL's handleRedirectPromise in main.jsx
export default function AuthProvider({ redirectResult, redirectError, children }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState(redirectError ? redirectError.errorMessage || redirectError.message : '');
  const started = useRef(false);

  // Clears only this app's session (the Microsoft session stays)
  const clearSession = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  const loadUser = useCallback(async () => {
    const token = getToken();
    if (!token || isTokenExpired(token)) {
      clearSession();
      return null;
    }
    try {
      const me = await getMe();
      setUser(me);
      return me;
    } catch {
      clearSession();
      return null;
    }
  }, [clearSession]);

  // Microsoft ID token -> POST /api/auth/microsoft -> app JWT -> user profile
  const exchangeToken = useCallback(async (idToken, returnTo) => {
    setError('');
    try {
      const { token } = await loginWithMicrosoft(idToken);
      setToken(token);
      await loadUser();
      navigate(returnTo || '/dashboard', { replace: true });
    } catch (err) {
      clearSession();
      setError(getErrorMessage(err));
    }
  }, [clearSession, loadUser, navigate]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const task = redirectResult?.idToken
      ? exchangeToken(redirectResult.idToken, redirectResult.state)
      : loadUser();
    task.finally(() => setLoading(false));
  }, [redirectResult, exchangeToken, loadUser]);

  // The axios client fires this when the API rejects the app JWT (detail: e.g. "account deactivated")
  useEffect(() => {
    const onUnauthorized = (e) => {
      clearSession();
      if (e.detail) setError(e.detail);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [clearSession]);

  // Reuses an existing Microsoft session when possible, otherwise redirects to Microsoft
  const login = useCallback(async (returnTo = '/dashboard') => {
    setSigningIn(true);
    setError('');
    try {
      const idToken = await getMicrosoftIdTokenSilently();
      if (idToken) {
        await exchangeToken(idToken, returnTo);
        setSigningIn(false);
      } else {
        await signInWithMicrosoft(returnTo); // page navigates away to Microsoft
      }
    } catch (err) {
      setError(err.errorMessage || err.message);
      setSigningIn(false);
    }
  }, [exchangeToken]);

  const logout = useCallback(async () => {
    // Record the sign-out while the app token is still valid; never block signing out on it
    await logoutApi().catch(() => {});
    clearSession();
    signOutOfMicrosoft();
  }, [clearSession]);

  // Signing out in one tab (token removed from localStorage) signs out the other tabs too
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === appConfig.tokenStorageKey && !e.newValue) setUser(null);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    signingIn,
    error,
    isAuthenticated: Boolean(user),
    login,
    logout,
    refreshUser: loadUser,
  }), [user, loading, signingIn, error, login, logout, loadUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
