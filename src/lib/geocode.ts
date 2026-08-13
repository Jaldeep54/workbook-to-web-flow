/**
 * Free, keyless location helpers: OpenStreetMap's Nominatim for address
 * search, and the browser's native Geolocation API for "use my location."
 */

export type GeocodeResult = {
  displayName: string;
  latitude: number;
  longitude: number;
};

/** Address search via Nominatim. One request per explicit user action — never call this on every keystroke. */
export async function searchAddress(query: string): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (!q) return [];

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Address search failed");

  const data = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>;
  return data.map((r) => ({
    displayName: r.display_name,
    latitude: Number(r.lat),
    longitude: Number(r.lon),
  }));
}

/** Best-effort address label for a coordinate pair (e.g. after "use current location"). */
export async function reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("format", "jsonv2");

  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as { display_name?: string };
    return data.display_name ?? null;
  } catch {
    return null;
  }
}

export function getCurrentPosition(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation is not available in this browser"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => reject(new Error(err.message || "Could not get your current location")),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  });
}
