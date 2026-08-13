/**
 * The actual Leaflet map for "Shops on Map". Loaded lazily (see the
 * /shops/map route) so leaflet/react-leaflet never end up in the SSR bundle.
 */
import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import type { Shop } from "@/lib/domain";

delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

export type ShopWithLocation = Shop & { latitude: number; longitude: number };

function FitToShops({ shops }: { shops: ShopWithLocation[] }) {
  const map = useMap();
  useEffect(() => {
    if (shops.length === 0) return;
    if (shops.length === 1) {
      map.setView([shops[0].latitude, shops[0].longitude], 15);
      return;
    }
    const bounds = L.latLngBounds(shops.map((s) => [s.latitude, s.longitude] as [number, number]));
    map.fitBounds(bounds, { padding: [32, 32] });
  }, [shops, map]);
  return null;
}

export default function ShopsMapInner({ shops }: { shops: ShopWithLocation[] }) {
  return (
    <MapContainer center={[20.5937, 78.9629]} zoom={5} scrollWheelZoom className="size-full">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitToShops shops={shops} />
      {shops.map((shop) => (
        <Marker key={shop.id} position={[shop.latitude, shop.longitude]}>
          <Popup>
            <div className="min-w-48 space-y-1">
              <p className="font-semibold">{shop.shop_name}</p>
              {shop.label_name && (
                <p className="text-xs text-muted-foreground">{shop.label_name}</p>
              )}
              {shop.address && <p className="text-sm">{shop.address}</p>}
              {(shop.mobile || shop.handled_by) && (
                <p className="text-sm text-muted-foreground">
                  {[shop.mobile, shop.handled_by].filter(Boolean).join(" · ")}
                </p>
              )}
              <Button asChild size="sm" className="mt-2 w-full">
                <Link to="/shops/$shopId" params={{ shopId: shop.id }}>
                  View shop
                </Link>
              </Button>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
