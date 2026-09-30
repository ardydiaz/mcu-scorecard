import { createContext } from 'react';

// Value: { user, loading, signingIn, error, isAuthenticated, login, logout, refreshUser }
const AuthContext = createContext(null);

export default AuthContext;
