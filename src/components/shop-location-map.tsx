/**
 * The actual Leaflet map for picking a shop's location. Loaded lazily
 * (see LocationPicker) so leaflet/react-leaflet never end up in the SSR
 * bundle — Leaflet only works in a real browser.
 */
import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// Vite bundles Leaflet's default marker icons at paths the browser can't resolve — repoint them.
delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const DEFAULT_CENTER: [number, number] = [20.5937, 78.9629]; // India, whole-country view
const DEFAULT_ZOOM = 5;
const PICK_ZOOM = 16;

function RecenterOnChange({
  latitude,
  longitude,
}: {
  latitude: number | null;
  longitude: number | null;
}) {
  const map = useMap();
  const hadPosition = useRef(false);
  useEffect(() => {
    if (latitude == null || longitude == null) return;
    map.setView([latitude, longitude], hadPosition.current ? map.getZoom() : PICK_ZOOM);
    hadPosition.current = true;
  }, [latitude, longitude, map]);
  return null;
}

function ClickToPlace({ onChange }: { onChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onChange(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function ShopLocationMapInner({
  latitude,
  longitude,
  onChange,
}: {
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number, lng: number) => void;
}) {
  const hasPosition = latitude != null && longitude != null;

  return (
    <MapContainer
      center={hasPosition ? [latitude, longitude] : DEFAULT_CENTER}
      zoom={hasPosition ? PICK_ZOOM : DEFAULT_ZOOM}
      scrollWheelZoom
      className="size-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <RecenterOnChange latitude={latitude} longitude={longitude} />
      <ClickToPlace onChange={onChange} />
      {hasPosition && (
        <Marker
          position={[latitude, longitude]}
          draggable
          eventHandlers={{
            dragend: (e) => {
              const pos = (e.target as L.Marker).getLatLng();
              onChange(pos.lat, pos.lng);
            },
          }}
        />
      )}
    </MapContainer>
  );
}
