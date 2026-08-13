/**
 * Shared Google Maps JS API loader. `importLibrary` caches per-library after
 * the first call, so every caller can just await the library it needs.
 */
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

let configured = false;

function ensureConfigured() {
  if (configured) return;
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error(
      "Missing VITE_GOOGLE_MAPS_API_KEY — set it in your .env file (see .env.example) and in Vercel's environment variables.",
    );
  }
  setOptions({ key: apiKey, v: "weekly" });
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
