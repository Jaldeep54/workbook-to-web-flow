/**
 * The only place the frontend talks to the network.
 *
 * Everything else in the app imports a typed service function; nothing builds
 * its own fetch, and nothing knows a database exists. Three things live here:
 *
 *  - the response envelope contract (`{ success, data, meta }` / `{ error }`),
 *  - the access token, held in memory only (never localStorage, so an XSS
 *    can't lift it from storage), and
 *  - transparent refresh: one 401 triggers a single refresh call through the
 *    httpOnly cookie, and the original request is replayed once.
 */
export type ApiMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
};

export type ApiErrorDetail = { field: string; message: string };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ApiErrorDetail[];

  constructor(status: number, code: string, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** True when the failure is "you're not allowed", not "something broke". */
  get isForbidden() {
    return this.status === 403;
  }
}

/**
 * Absolute (`https://api.example.com/api/v1`) or origin-relative (`/api/v1`).
 * The relative form is what a same-origin deployment uses — the host rewrites
 * `/api/*` to the API — and it keeps the refresh cookie first-party.
 */
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://localhost:4000/api/v1";

let accessToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Lets the auth provider react when the session is definitively gone. */
export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

/**
 * Exchanges the httpOnly refresh cookie for a new access token. Concurrent
 * callers share one in-flight request so a burst of 401s can't stampede.
 */
export async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
        });
        if (!response.ok) return false;
        const payload = await response.json();
        accessToken = payload?.data?.accessToken ?? null;
        return Boolean(accessToken);
      } catch {
        return false;
      } finally {
        // Cleared on the next tick so simultaneous callers all observe the
        // same result before a new attempt can start.
        setTimeout(() => {
          refreshInFlight = null;
        }, 0);
      }
    })();
  }
  return refreshInFlight;
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Sent as multipart/form-data; `body` is ignored when present. */
  formData?: FormData;
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
  /** Skips the refresh-and-retry dance (used by the refresh call itself). */
  skipAuthRetry?: boolean;
};

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  // `new URL` needs a base when API_BASE_URL is origin-relative.
  const url = new URL(
    `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`,
    typeof window === "undefined" ? "http://localhost" : window.location.origin,
  );
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function parseError(response: Response): Promise<ApiError> {
  let code = "REQUEST_FAILED";
  let message = `Request failed with status ${response.status}`;
  let details: ApiErrorDetail[] | undefined;

  try {
    const payload = await response.json();
    if (payload?.error) {
      code = payload.error.code ?? code;
      message = payload.error.message ?? message;
      details = payload.error.details;
    }
  } catch {
    // Non-JSON error (proxy, gateway) — keep the generic message.
  }

  // Field errors are what the user actually needs to read.
  if (details?.length) {
    message = `${message}: ${details.map((d) => `${d.field} — ${d.message}`).join("; ")}`;
  }
  return new ApiError(response.status, code, message, details);
}

async function send<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; meta?: ApiMeta }> {
  const { method = "GET", body, formData, query, signal, skipAuthRetry } = options;

  const execute = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (!formData && body !== undefined) headers["content-type"] = "application/json";

    return fetch(buildUrl(path, query), {
      method,
      headers,
      credentials: "include",
      signal,
      body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  };

  let response = await execute();

  if (response.status === 401 && !skipAuthRetry) {
    const refreshed = await refreshSession();
    if (refreshed) {
      response = await execute();
    } else {
      accessToken = null;
      onUnauthenticated?.();
    }
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return { data: undefined as T };

  const payload = await response.json();
  return { data: payload?.data as T, meta: payload?.meta as ApiMeta | undefined };
}

/** Returns just the payload — what almost every caller wants. */
export async function apiRequest<T>(path: string, options?: RequestOptions): Promise<T> {
  return (await send<T>(path, options)).data;
}

/** Returns payload plus pagination metadata, for paged tables. */
export async function apiRequestWithMeta<T>(
  path: string,
  options?: RequestOptions,
): Promise<{ data: T; meta?: ApiMeta }> {
  return send<T>(path, options);
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"]) => apiRequest<T>(path, { query }),
  post: <T>(path: string, body?: unknown, query?: RequestOptions["query"]) =>
    apiRequest<T>(path, { method: "POST", body, query }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "PUT", body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, formData: FormData) =>
    apiRequest<T>(path, { method: "POST", formData }),
  list: <T>(path: string, query?: RequestOptions["query"]) =>
    apiRequestWithMeta<T>(path, { query }),
};

/**
 * Resolves a signed file path returned by the API against the API's own origin.
 * With a relative base the result stays relative, which is exactly right — the
 * host rewrites it to the API just like every other call.
 */
export function fileUrl(signedPath: string): string {
  if (/^https?:\/\//.test(signedPath)) return signedPath;
  const origin = API_BASE_URL.replace(/\/api\/v1$/, "");
  return `${origin}${signedPath}`;
}
