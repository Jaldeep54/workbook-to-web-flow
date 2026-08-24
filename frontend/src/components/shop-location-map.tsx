/**
 * The actual Google Maps map for picking a shop's location. Loaded lazily
 * (see LocationPicker) so the Google Maps script only ever loads client-side.
 */
import { useEffect, useRef, useState } from "react";
import { MapUnavailable } from "@/components/map-unavailable";
import { MAPS_LOAD_FAILED, loadMapsLibrary, loadMarkerLibrary } from "@/lib/google-maps-loader";

const DEFAULT_CENTER = { lat: 20.5937, lng: 78.9629 }; // India, whole-country view
const DEFAULT_ZOOM = 5;
const PICK_ZOOM = 16;

export default function ShopLocationMapInner({
  latitude,
  longitude,
  onChange,
}: {
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number, lng: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const markerCtorRef = useRef<typeof google.maps.Marker | null>(null);
  const hadPositionRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let libraries;
      try {
        libraries = await Promise.all([loadMapsLibrary(), loadMarkerLibrary()]);
      } catch (error) {
        // Without this the container just sits blank forever.
        if (!cancelled) setLoadError(error instanceof Error ? error.message : MAPS_LOAD_FAILED);
        return;
      }
      const [{ Map }, { Marker }] = libraries;
      if (cancelled || !containerRef.current) return;
      markerCtorRef.current = Marker;
      const map = new Map(containerRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
      });
      map.addListener("click", (e: google.maps.MapMouseEvent) => {
        if (e.latLng) onChangeRef.current(e.latLng.lat(), e.latLng.lng());
      });
      mapRef.current = map;
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the marker + view in sync with the current position, however it changed
  // (search result, GPS, drag, or a map click).
  useEffect(() => {
    const map = mapRef.current;
    const MarkerCtor = markerCtorRef.current;
    if (!ready || !map || !MarkerCtor || latitude == null || longitude == null) return;
    const position = { lat: latitude, lng: longitude };

    map.setCenter(position);
    map.setZoom(hadPositionRef.current ? (map.getZoom() ?? PICK_ZOOM) : PICK_ZOOM);
    hadPositionRef.current = true;

    if (markerRef.current) {
      markerRef.current.setPosition(position);
    } else {
      const marker = new MarkerCtor({ position, map, draggable: true });
      marker.addListener("dragend", () => {
        const pos = marker.getPosition();
        if (pos) onChangeRef.current(pos.lat(), pos.lng());
      });
      markerRef.current = marker;
    }
  }, [ready, latitude, longitude]);

  if (loadError) return <MapUnavailable reason={loadError} />;

  return <div ref={containerRef} className="size-full" />;
}
