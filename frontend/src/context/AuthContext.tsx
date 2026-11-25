import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Balances } from "../api";

interface UserSession {
  token: string;
  userId: string;
  username: string;
}

interface AuthContextValue {
  user: UserSession | null;
  balances: Balances;
  signin: (username: string, password: string) => Promise<void>;
  signup: (username: string, password: string) => Promise<void>;
  signout: () => void;
  refreshBalances: () => Promise<void>;
}

const STORAGE_KEY = "cex_session";
const AuthContext = createContext<AuthContextValue | null>(null);

function loadSession(): UserSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserSession;
    return parsed?.token ? parsed : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(loadSession);
  const [balances, setBalances] = useState<Balances>({});

  const refreshBalances = useCallback(async () => {
    if (!user?.token) {
      setBalances({});
      return;
    }
    try {
      const res = await api.getBalances(user.token);
      setBalances(res.balances);
    } catch {
      // Keep previous balances on transient network error
    }
  }, [user?.token]);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances]);

  const saveSession = (session: UserSession) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    setUser(session);
  };

  const signin = async (username: string, password: string) => {
    const res = await api.signin(username, password);
    saveSession(res);
  };

  const signup = async (username: string, password: string) => {
    const res = await api.signup(username, password);
    saveSession(res);
  };

  const signout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
    setBalances({});
  };

  return (
    <AuthContext.Provider value={{ user, balances, signin, signup, signout, refreshBalances }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
