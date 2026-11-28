import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  getAccessToken,
  isTransientFailure,
  refreshSession,
  setUnauthenticatedHandler,
} from "@/services/api-client";
import {
  fetchMe,
  login as loginRequest,
  logout as logoutRequest,
  type AuthUser,
} from "@/services/auth.service";

/**
 * Session state for the whole app.
 *
 * On boot there is no access token in memory (deliberately — it is never
 * persisted), so the provider asks the API to exchange the httpOnly refresh
 * cookie for one. That's what keeps a reload signed in without giving an XSS
 * anything to steal.
 *
 * `permissions` is the flat `resource:action` list the backend computed from
 * the user's role and any direct grants. The UI uses it to hide what a user
 * can't do — the API enforces the same rules independently.
 */
type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  /** Set when the session couldn't be restored because the server was unreachable. */
  sessionError: string | null;
  retrySession: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  sessionError: null,
  retrySession: () => {},
  signIn: async () => {},
  signOut: async () => {},
  refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const [sessionError, setSessionError] = useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setSessionError(null);
      try {
        if (!getAccessToken()) {
          const restored = await refreshSession();
          if (!restored) {
            if (!cancelled) setUser(null);
            return;
          }
        }
        const me = await fetchMeWithRetry();
        if (!cancelled) setUser(me);
      } catch (error) {
        if (cancelled) return;
        // Only a definite "no session" signs the user out. A server or
        // network failure keeps them here with a retry, so a flaky reload
        // never bounces them to the login page.
        if (isTransientFailure(error)) {
          setSessionError(error instanceof Error ? error.message : "Couldn't reach the server");
        } else {
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [restoreAttempt]);

  const retrySession = useCallback(() => setRestoreAttempt((n) => n + 1), []);

  // When a refresh finally fails, the session is over — drop the user and any
  // cached data belonging to them.
  useEffect(() => {
    setUnauthenticatedHandler(() => {
      setUser(null);
      queryClient.clear();
    });
    return () => setUnauthenticatedHandler(null);
  }, [queryClient]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const signedIn = await loginRequest(email, password);
      setUser(signedIn);
      queryClient.clear();
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    await logoutRequest();
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const refreshUser = useCallback(async () => {
    setUser(await fetchMe());
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, sessionError, retrySession, signIn, signOut, refreshUser }),
    [user, loading, sessionError, retrySession, signIn, signOut, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** `/auth/me` on boot, retried through a cold start or dropped connection. */
async function fetchMeWithRetry(): Promise<AuthUser> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchMe();
    } catch (error) {
      if (attempt >= 2 || !isTransientFailure(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
}

export const useAuth = () => useContext(AuthContext);
