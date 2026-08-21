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

import { getAccessToken, refreshSession, setUnauthenticatedHandler } from "@/services/api-client";
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
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
  refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (!getAccessToken()) {
          const restored = await refreshSession();
          if (!restored) {
            if (!cancelled) setUser(null);
            return;
          }
        }
        const me = await fetchMe();
        if (!cancelled) setUser(me);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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
    () => ({ user, loading, signIn, signOut, refreshUser }),
    [user, loading, signIn, signOut, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
