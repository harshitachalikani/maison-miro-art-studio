/**
 * AuthContext.jsx — Global authentication state for MAISON MIRO.
 * Provides: { user, token, login, logout, loading }
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiLogin, clearToken, fetchMe, getToken, setToken } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]     = useState(null);
  const [loading, setLoading] = useState(true); // true while we check existing token

  // On mount: if a token exists, verify it with /api/auth/me
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    fetchMe()
      .then((data) => setUser(data.user))
      .catch(() => {
        // Token expired or invalid — clear it silently
        clearToken();
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await apiLogin(email, password); // throws on failure
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
