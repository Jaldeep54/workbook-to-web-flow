import { lazy, Suspense, useState } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { LocateFixed, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getCurrentPosition,
  reverseGeocode,
  searchAddress,
  type GeocodeResult,
} from "@/lib/geocode";

const ShopLocationMap = lazy(() => import("./shop-location-map"));

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
}: {
  address: string;
  latitude: number | null;
  longitude: number | null;
  onLocationChange: (loc: { latitude: number; longitude: number; address?: string }) => void;
}) {
  const [query, setQuery] = useState(address);
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);

  const runSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setResults([]);
    try {
      const found = await searchAddress(query);
      if (found.length === 0) toast.error("No matching address found");
      setResults(found);
    } catch {
      toast.error("Address search failed — try again");
    } finally {
      setSearching(false);
    }
  };

  const handleUseCurrentLocation = async () => {
    setLocating(true);
    try {
      const pos = await getCurrentPosition();
      const label = await reverseGeocode(pos.latitude, pos.longitude);
      onLocationChange(label ? { ...pos, address: label } : pos);
      if (label) setQuery(label);
      toast.success("Location set from your device");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not get your current location");
    } finally {
      setLocating(false);
    }
  };

  return (
    <div className="space-y-3">
      <Label className="text-xs">Location</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex flex-1 gap-2">
          <Input
            placeholder="Search for the shop address…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void runSearch();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => void runSearch()}
            disabled={searching}
          >
            {searching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
          </Button>
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

      {results.length > 0 && (
        <div className="max-h-40 overflow-y-auto rounded-md border border-border">
          {results.map((r, i) => (
            <button
              type="button"
              key={i}
              className="block w-full border-b border-border/60 px-3 py-2 text-left text-sm last:border-0 hover:bg-accent"
              onClick={() => {
                onLocationChange({
                  latitude: r.latitude,
                  longitude: r.longitude,
                  address: r.displayName,
                });
                setQuery(r.displayName);
                setResults([]);
              }}
            >
              {r.displayName}
            </button>
          ))}
        </div>
      )}

      <div className="h-64 overflow-hidden rounded-md border border-border">
        <Suspense fallback={<MapFallback />}>
          <ClientOnly fallback={<MapFallback />}>
            <ShopLocationMap
              latitude={latitude}
              longitude={longitude}
              onChange={(lat, lng) => onLocationChange({ latitude: lat, longitude: lng })}
            />
          </ClientOnly>
        </Suspense>
      </div>
      <p className="text-xs text-muted-foreground">
        {latitude != null && longitude != null
          ? `${latitude.toFixed(6)}, ${longitude.toFixed(6)} — click the map or drag the pin to fine-tune`
          : "Search an address, use your current location, or click the map to place a pin."}
      </p>
    </div>
  );
}
