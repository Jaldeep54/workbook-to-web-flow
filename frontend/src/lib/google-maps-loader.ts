/**
 * Shared Google Maps JS API loader. `importLibrary` caches per-library after
 * the first call, so every caller can just await the library it needs.
 *
 * Maps are an optional integration: the app is perfectly usable without a key
 * (a shop's coordinates can be typed in by hand), so nothing here throws at
 * import time. Callers ask `mapsUnavailableReason()` first and show the
 * fallback UI when it returns a message.
 */
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

export const MAPS_KEY_MISSING =
  "Google Maps is not set up: VITE_GOOGLE_MAPS_API_KEY is empty. Create a key in the Google Cloud Console, enable Maps JavaScript, Places and Geocoding on it, then add it to frontend/.env and to the Vercel project's environment variables.";

export const MAPS_KEY_REJECTED =
  "Google rejected the Maps API key. Open the browser console for the exact reason: it logs a code such as RefererNotAllowedMapError or ApiNotActivatedMapError.";

/**
 * What each of Google's auth failures actually means, phrased as the fix.
 * Google reports the reason only through a `console.error`, so the codes are
 * scraped from there (see `watchForAuthErrorCode`) — without this the user is
 * left guessing between four unrelated causes.
 *
 * Codes: developers.google.com/maps/documentation/javascript/error-messages
 */
const AUTH_ERROR_FIXES: Record<string, string> = {
  RefererNotAllowedMapError:
    "this site's address is not on the key's allowed referrer list. In Google Cloud Console → APIs & Services → Credentials, open the key and add it under Website restrictions.",
  RefererDeniedMapError:
    "this site's address is not on the key's allowed referrer list. In Google Cloud Console → APIs & Services → Credentials, open the key and add it under Website restrictions.",
  ApiNotActivatedMapError:
    "the Maps JavaScript API is not enabled on the key's project. Enable Maps JavaScript API, Places API (New) and Geocoding API in Google Cloud Console → APIs & Services → Library.",
  ApiTargetBlockedMapError:
    "the key's API restrictions do not include the Maps JavaScript API. In Google Cloud Console → Credentials, open the key and add Maps JavaScript, Places and Geocoding under API restrictions.",
  BillingNotEnabledMapError:
    "the key's Google Cloud project has no billing account. Maps will not serve a single request until billing is linked, even inside the free monthly credit.",
  InvalidKeyMapError:
    "Google does not recognise this key. Check VITE_GOOGLE_MAPS_API_KEY for a typo, and that the key has not been deleted.",
  ExpiredKeyMapError: "this key has expired — create a new one in Google Cloud Console.",
  MalformedCredentialsMapError:
    "the key is malformed. Check VITE_GOOGLE_MAPS_API_KEY for stray quotes or whitespace.",
  ProjectDeniedMapError:
    "the key's Google Cloud project is denied or suspended. Check the project's status in Google Cloud Console.",
  OverQuotaMapError:
    "the key is over its usage quota. Check quotas and billing in Google Cloud Console.",
};

/** The specific `…MapError` Google reported, once it has reported one. */
let authErrorCode: string | null = null;

/**
 * Google logs the reason for an auth failure to the console and nowhere else —
 * `gm_authFailure` is called with no arguments. Reading it back from the log is
 * the only way to tell the user which of the causes actually applies.
 *
 * Only `error:` lines count. Google logs non-fatal `warning:` lines in the same
 * format (RetiredVersion, SensorNotRequired…), and treating one of those as a
 * failure would blank a map that works perfectly well.
 */
function watchForAuthErrorCode() {
  if (typeof console === "undefined") return;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const code = /Google Maps JavaScript API error: (\w+)/.exec(args.join(" "))?.[1];
    if (code && !authErrorCode) {
      authErrorCode = code;
      for (const listener of listeners) listener();
    }
    original(...args);
  };
}

/** The rejection message, naming the specific cause when Google gave one. */
function rejectionMessage(): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  if (!authErrorCode) return MAPS_KEY_REJECTED;

  const fix = AUTH_ERROR_FIXES[authErrorCode];
  const where =
    origin &&
    (authErrorCode === "RefererNotAllowedMapError" || authErrorCode === "RefererDeniedMapError")
      ? ` This page is ${origin} — allow ${origin}/*`
      : "";
  return fix
    ? `Google rejected the Maps API key (${authErrorCode}): ${fix}${where}`
    : `Google rejected the Maps API key (${authErrorCode}). See developers.google.com/maps/documentation/javascript/error-messages for what that code means.`;
}

export const MAPS_LOAD_FAILED =
  "Google Maps could not be loaded. Check your connection and the browser console for the exact error.";

function apiKey(): string {
  return (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() ?? "";
}

/**
 * Google reports a bad key asynchronously, long after `importLibrary` has
 * resolved, by calling this global — without it a rejected key shows only as a
 * dimmed, watermarked map and an error buried in the console.
 */
let authFailed = false;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
    authFailed = true;
    for (const listener of listeners) listener();
  };
  watchForAuthErrorCode();
}

/** `null` when maps are usable; otherwise the reason to show the user. */
export function mapsUnavailableReason(): string | null {
  if (!apiKey()) return MAPS_KEY_MISSING;
  if (authFailed || (authErrorCode && authErrorCode in AUTH_ERROR_FIXES)) {
    return rejectionMessage();
  }
  return null;
}

/** Subscribe to the async "Google rejected the key" verdict. Returns an unsubscribe. */
export function onMapsStatusChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let configured = false;

function ensureConfigured() {
  if (configured) return;
  const key = apiKey();
  if (!key) throw new Error(MAPS_KEY_MISSING);
  setOptions({ key, v: "weekly" });
  configured = true;
}

export function loadMapsLibrary() {
  ensureConfigured();
  return importLibrary("maps");
}

/** LatLng/LatLngBounds and other core geometry types live here, not in "maps". */
export function loadCoreLibrary() {
  ensureConfigured();
  return importLibrary("core");
}

export function loadMarkerLibrary() {
  ensureConfigured();
  return importLibrary("marker");
}

export function loadPlacesLibrary() {
  ensureConfigured();
  return importLibrary("places");
}

export function loadGeocodingLibrary() {
  ensureConfigured();
  return importLibrary("geocoding");
}
