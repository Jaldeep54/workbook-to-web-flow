import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { LocateFixed, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { MapUnavailable, useMapsUnavailableReason } from "@/components/map-unavailable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createAutocompleteSession,
  fetchPlaceSuggestions,
  getCurrentPosition,
  resolvePlace,
  reverseGeocode,
  type PlaceSuggestion,
} from "@/lib/geocode";

const ShopLocationMap = lazy(() => import("./shop-location-map"));
const SEARCH_DEBOUNCE_MS = 300;

function MapFallback() {
  return (
    <div className="grid size-full place-items-center bg-muted/40 text-sm text-muted-foreground">
      Loading map…
    </div>
  );
}

export function LocationPicker({
  address,
  latitude,
  longitude,
  onLocationChange,
  required = false,
}: {
  address: string;
  latitude: number | null;
  longitude: number | null;
  onLocationChange: (loc: { latitude: number; longitude: number; address?: string }) => void;
  /** Marks the field with an asterisk — the caller still does the validating. */
  required?: boolean;
}) {
  const mapsUnavailable = useMapsUnavailableReason();
  const [query, setQuery] = useState(address);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const sessionRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const requestIdRef = useRef(0);
  const skipNextSearchRef = useRef(false);

  useEffect(() => {
    if (mapsUnavailable) return;
    void createAutocompleteSession().then((token) => {
      sessionRef.current = token;
    });
  }, [mapsUnavailable]);

  useEffect(() => {
    if (mapsUnavailable) return;
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      setSuggestions([]);
      return;
    }
    if (!query.trim() || query === address) {
      setSuggestions([]);
      return;
    }
    const requestId = ++requestIdRef.current;
    const timer = window.setTimeout(() => {
      (async () => {
        setSearching(true);
        setSearchError(false);
        try {
          if (!sessionRef.current) sessionRef.current = await createAutocompleteSession();
          const found = await fetchPlaceSuggestions(query, sessionRef.current);
          if (requestId === requestIdRef.current) setSuggestions(found);
        } catch {
          if (requestId === requestIdRef.current) setSearchError(true);
        } finally {
          if (requestId === requestIdRef.current) setSearching(false);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const selectSuggestion = async (suggestion: PlaceSuggestion) => {
    setSuggestions([]);
    skipNextSearchRef.current = true;
    setQuery(suggestion.text);
    try {
      const resolved = await resolvePlace(suggestion.prediction);
      onLocationChange(resolved);
      skipNextSearchRef.current = true;
      setQuery(resolved.address);
    } catch {
      toast.error("Could not load that place — try another result");
    } finally {
      // Start a fresh session for the next search, per Google's billing guidance.
      sessionRef.current = null;
      void createAutocompleteSession().then((token) => {
        sessionRef.current = token;
      });
    }
  };

  const handleUseCurrentLocation = async () => {
    setLocating(true);
    try {
      const pos = await getCurrentPosition();
      const label = mapsUnavailable ? null : await reverseGeocode(pos.latitude, pos.longitude);
      onLocationChange(label ? { ...pos, address: label } : pos);
      if (label) {
        skipNextSearchRef.current = true;
        setQuery(label);
      }
      toast.success("Location set from your device");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not get your current location");
    } finally {
      setLocating(false);
    }
  };

  return (
    <div className="space-y-3">
      <Label className="text-xs">
        Location{" "}
        {required && (
          <span className="text-destructive" aria-label="required">
            *
          </span>
        )}
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Input
            placeholder={
              mapsUnavailable ? "Address search needs a Maps key" : "Search for the shop address…"
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={!!mapsUnavailable}
          />
          <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
            {searching ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <Search className="size-4 text-muted-foreground" />
            )}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleUseCurrentLocation()}
          disabled={locating}
        >
          {locating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <LocateFixed className="size-4" />
          )}
          Use current location
        </Button>
      </div>

      {searchError && (
        <p className="text-xs text-destructive">Address search failed — try again.</p>
      )}

      {suggestions.length > 0 && (
        <div className="max-h-40 overflow-y-auto rounded-md border border-border">
          {suggestions.map((s) => (
            <button
              type="button"
              key={s.id}
              className="block w-full border-b border-border/60 px-3 py-2 text-left text-sm last:border-0 hover:bg-accent"
              onClick={() => void selectSuggestion(s)}
            >
              {s.text}
            </button>
          ))}
        </div>
      )}

      <div className="h-64 overflow-hidden rounded-md border border-border">
        {mapsUnavailable ? (
          <MapUnavailable reason={mapsUnavailable} />
        ) : (
          <Suspense fallback={<MapFallback />}>
            <ClientOnly fallback={<MapFallback />}>
              <ShopLocationMap
                latitude={latitude}
                longitude={longitude}
                onChange={(lat, lng) => onLocationChange({ latitude: lat, longitude: lng })}
              />
            </ClientOnly>
          </Suspense>
        )}
      </div>

      {/* Always available, and the only way to set a location while the map is
          down — paste the coordinates out of the Google Maps app. */}
      <ManualCoordinates
        latitude={latitude}
        longitude={longitude}
        onLocationChange={onLocationChange}
      />

      <p className="text-xs text-muted-foreground">
        {latitude != null && longitude != null
          ? `${latitude.toFixed(6)}, ${longitude.toFixed(6)}${mapsUnavailable ? "" : " — click the map or drag the pin to fine-tune"}`
          : mapsUnavailable
            ? "Use your current location, or type the coordinates in below."
            : "Search an address, use your current location, or click the map to place a pin."}
      </p>
    </div>
  );
}

const COORD_PAIR = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/;

/**
 * Type or paste "21.170240, 72.831062" — the format Google Maps itself copies
 * to the clipboard. Keeps a shop's location editable when the map can't load.
 */
function ManualCoordinates({
  latitude,
  longitude,
  onLocationChange,
}: {
  latitude: number | null;
  longitude: number | null;
  onLocationChange: (loc: { latitude: number; longitude: number }) => void;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const match = COORD_PAIR.exec(draft);
    if (!match) {
      setError("Enter coordinates as latitude, longitude — e.g. 21.170240, 72.831062");
      return;
    }
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setError("Latitude must be between -90 and 90, longitude between -180 and 180");
      return;
    }
    setError(null);
    setDraft("");
    onLocationChange({ latitude: lat, longitude: lng });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder={
            latitude != null && longitude != null
              ? `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
              : "Or paste coordinates: 21.170240, 72.831062"
          }
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={apply} disabled={!draft.trim()}>
          Set pin
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
