/**
 * Location helpers backed by Google Maps Platform: the (new) Places API for
 * address search suggestions, the Geocoding API for reverse geocoding, and
 * the browser's native Geolocation API for "use my location."
 */
import { loadGeocodingLibrary, loadPlacesLibrary } from "./google-maps-loader";

export type PlaceSuggestion = {
  id: string;
  text: string;
  prediction: google.maps.places.PlacePrediction;
};

export async function createAutocompleteSession(): Promise<google.maps.places.AutocompleteSessionToken> {
  const { AutocompleteSessionToken } = await loadPlacesLibrary();
  return new AutocompleteSessionToken();
}

/** Live search-as-you-type suggestions via Places Autocomplete (New). */
export async function fetchPlaceSuggestions(
  query: string,
  sessionToken: google.maps.places.AutocompleteSessionToken,
): Promise<PlaceSuggestion[]> {
  const input = query.trim();
  if (!input) return [];

  const { AutocompleteSuggestion } = await loadPlacesLibrary();
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input,
    sessionToken,
  });

  return suggestions
    .filter((s) => s.placePrediction != null)
    .map((s) => {
      const prediction = s.placePrediction!;
      return { id: prediction.placeId, text: prediction.text.toString(), prediction };
    });
}

/** Resolves a chosen suggestion into coordinates + a formatted address. */
export async function resolvePlace(
  prediction: google.maps.places.PlacePrediction,
): Promise<{ latitude: number; longitude: number; address: string }> {
  const place = prediction.toPlace();
  const { place: full } = await place.fetchFields({ fields: ["location", "formattedAddress"] });
  if (!full.location) throw new Error("This place has no location data");
  return {
    latitude: full.location.lat(),
    longitude: full.location.lng(),
    address: full.formattedAddress ?? prediction.text.toString(),
  };
}

/** Best-effort address label for a coordinate pair (e.g. after "use current location"). */
export async function reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
  try {
    const { Geocoder } = await loadGeocodingLibrary();
    const { results } = await new Geocoder().geocode({
      location: { lat: latitude, lng: longitude },
    });
    return results[0]?.formatted_address ?? null;
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
