import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type ApiUser, type TelegramAuthData } from "../api";
import { applyAccent, isAccentKey, type AccentKey } from "../theme";

interface AuthState {
  user: ApiUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (displayName: string, email: string, password: string) => Promise<void>;
  loginWithTelegram: (data: TelegramAuthData) => Promise<void>;
  linkTelegram: (data: TelegramAuthData) => Promise<void>;
  unlinkTelegram: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (user: ApiUser | null) => void;
  setAccent: (accent: AccentKey) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.me();
      setUser(user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Restore session on load (the cookie may still be valid).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // When a signed-in user's accent preference loads, apply it (cross-device).
  useEffect(() => {
    if (user && isAccentKey(user.accentPreference)) applyAccent(user.accentPreference);
  }, [user]);

  const setAccent = useCallback(
    async (accent: AccentKey) => {
      applyAccent(accent);
      try {
        const res = await api.setAccent(accent);
        setUser(res.user);
      } catch {
        /* anonymous or offline — localStorage still holds it */
      }
    },
    [],
  );

  const login = useCallback(async (email: string, password: string) => {
    const { user } = await api.login({ email, password });
    setUser(user);
  }, []);

  const signup = useCallback(async (displayName: string, email: string, password: string) => {
    const { user } = await api.signup({ displayName, email, password });
    setUser(user);
  }, []);

  const loginWithTelegram = useCallback(async (data: TelegramAuthData) => {
    const { user } = await api.telegramLogin(data);
    setUser(user);
  }, []);

  const linkTelegram = useCallback(async (data: TelegramAuthData) => {
    const { user } = await api.linkTelegram(data);
    setUser(user);
  }, []);

  const unlinkTelegram = useCallback(async () => {
    const { user } = await api.unlinkTelegram();
    setUser(user);
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await api.changePassword({ currentPassword, newPassword });
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        signup,
        loginWithTelegram,
        linkTelegram,
        unlinkTelegram,
        changePassword,
        logout,
        refresh,
        setUser,
        setAccent,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
