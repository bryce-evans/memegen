import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "@memegen/shared";
import { createSession, setSessionRejectedHandler, storedUser, storeUser } from "./api.ts";

interface AuthValue {
  user: User | null;
  signIn: (username: string) => Promise<User>;
  signOut: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(storedUser);
  useEffect(() => setSessionRejectedHandler(() => setUser(null)), []);

  const signIn = useCallback(async (username: string) => {
    const { user } = await createSession(username);
    storeUser(user);
    setUser(user);
    return user;
  }, []);

  const signOut = useCallback(() => {
    storeUser(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, signIn, signOut }), [user, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

/** The signed-in user. The app renders only behind the sign-in gate (`App.tsx`), so pages always have one. */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error("useUser must be used behind the sign-in gate");
  return user;
}
