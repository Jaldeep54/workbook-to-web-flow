import { api, apiRequest, setAccessToken } from "./api-client";

/** The session shape the whole app reads its identity and permissions from. */
export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  role: { id: string; name: string; slug: string; isSystem: boolean } | null;
  /** Flat `resource:action` grants, already merged from role + direct grants. */
  permissions: string[];
};

type SessionResponse = { accessToken: string; user: AuthUser };

export async function login(email: string, password: string): Promise<AuthUser> {
  const session = await apiRequest<SessionResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
    skipAuthRetry: true,
  });
  setAccessToken(session.accessToken);
  return session.user;
}

export async function logout(): Promise<void> {
  try {
    await api.post("/auth/logout");
  } finally {
    setAccessToken(null);
  }
}

export const fetchMe = () => api.get<AuthUser>("/auth/me");

export const updateProfile = (fullName: string) =>
  apiRequest<AuthUser>("/auth/me", { method: "PATCH", body: { fullName } });

export const changePassword = (currentPassword: string, newPassword: string) =>
  api.post<{ message: string }>("/auth/change-password", { currentPassword, newPassword });
