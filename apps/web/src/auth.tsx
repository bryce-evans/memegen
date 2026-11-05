import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AuthConfig, User } from "@memegen/shared";
import {
  createSession, deleteSession, getAuthConfig, getAuthSession, getMe,
  setAuthMode, setSessionRejectedHandler, storedUser, storeUser,
} from "./api.ts";

interface AuthValue {
  user: User | null;
  config: AuthConfig | null;
  loading: boolean;
  error: unknown;
  retry: () => void;
  signIn: (username: string) => Promise<User>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const mutating = useRef(false);

  useEffect(() => {
    let activeConfig: AuthConfig | null = null;
    setAuthMode(null);
    setConfig(null);
    setUser(null);
    setLoading(true);
    setError(null);
    setSessionRejectedHandler(() => {
      generation.current++;
      mutating.current = false;
      setUser(null);
      setLoading(false);
      setError(null);
    });

    async function session(auth: AuthConfig): Promise<User | null> {
      if (auth.mode === "oidc") return (await getAuthSession()).user;
      const stored = storedUser();
      return stored ? (await getMe()).user : null;
    }

    async function bootstrap() {
      const current = ++generation.current;
      try {
        const auth = await getAuthConfig();
        if (current !== generation.current) return;
        activeConfig = auth;
        setAuthMode(auth.mode);
        setConfig(auth);
        const nextUser = await session(auth);
        if (current !== generation.current) return;
        storeUser(nextUser);
        setUser(nextUser);
      } catch (err) {
        if (current === generation.current) setError(err);
      } finally {
        if (current === generation.current) setLoading(false);
      }
    }

    async function refresh() {
      if (!activeConfig || mutating.current) return;
      const current = ++generation.current;
      try {
        const nextUser = await session(activeConfig);
        if (current !== generation.current) return;
        storeUser(nextUser);
        setUser(nextUser);
        setError(null);
      } catch (err) {
        if (current !== generation.current) return;
        // A transient failure must not preserve unverified moderation privileges.
        setUser((value) => value && { ...value, isAdmin: false });
        setError(err);
      } finally {
        if (current === generation.current) setLoading(false);
      }
    }

    void bootstrap();
    window.addEventListener("focus", refresh);
    return () => {
      generation.current++;
      window.removeEventListener("focus", refresh);
      setSessionRejectedHandler(() => {});
      setAuthMode(null);
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const signIn = useCallback(async (username: string) => {
    if (config?.mode !== "dev") throw new Error("Username sign-in is not enabled by this server.");
    const current = ++generation.current;
    mutating.current = true;
    try {
      const { user } = await createSession(username);
      if (current === generation.current) {
        storeUser(user);
        setUser(user);
        setError(null);
      }
      return user;
    } finally {
      if (current === generation.current) mutating.current = false;
    }
  }, [config]);

  const signOut = useCallback(async () => {
    const current = ++generation.current;
    mutating.current = true;
    try {
      // Do not claim logout succeeded while the server's cookie session is still valid.
      await deleteSession();
      if (current !== generation.current) return;
      storeUser(null);
      setUser(null);
      setError(null);
    } finally {
      if (current === generation.current) mutating.current = false;
    }
  }, []);

  const value = useMemo(
    () => ({ user, config, loading, error, retry, signIn, signOut }),
    [user, config, loading, error, retry, signIn, signOut],
  );
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
