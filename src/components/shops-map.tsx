/**
 * The actual Google Maps map for "Shops on Map". Loaded lazily (see the
 * /shops/map route) so the Google Maps script only ever loads client-side.
 */
import { useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { MarkerClusterer } from "@googlemaps/markerclusterer";

import { loadCoreLibrary, loadMapsLibrary, loadMarkerLibrary } from "@/lib/google-maps-loader";
import type { Shop } from "@/lib/domain";

export type ShopWithLocation = Shop & { latitude: number; longitude: number };

const DEFAULT_CENTER = { lat: 20.5937, lng: 78.9629 }; // India, whole-country view
const DEFAULT_ZOOM = 5;

function buildInfoContent(
  shop: ShopWithLocation,
  onViewShop: (shopId: string) => void,
): HTMLElement {
  const root = document.createElement("div");
  root.className = "min-w-48 space-y-1";

  const name = document.createElement("p");
  name.className = "font-semibold";
  name.textContent = shop.shop_name;
  root.appendChild(name);

  if (shop.label_name) {
    const label = document.createElement("p");
    label.className = "text-xs text-muted-foreground";
    label.textContent = shop.label_name;
    root.appendChild(label);
  }

  if (shop.address) {
    const address = document.createElement("p");
    address.className = "text-sm";
    address.textContent = shop.address;
    root.appendChild(address);
  }

  const contact = [shop.mobile, shop.handled_by].filter(Boolean).join(" · ");
  if (contact) {
    const contactEl = document.createElement("p");
    contactEl.className = "text-sm text-muted-foreground";
    contactEl.textContent = contact;
    root.appendChild(contactEl);
  }

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "View shop";
  button.className =
    "mt-2 inline-flex h-8 w-full items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90";
  button.addEventListener("click", () => onViewShop(shop.id));
  root.appendChild(button);

  return root;
}

export default function ShopsMapInner({ shops }: { shops: ShopWithLocation[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let clusterer: MarkerClusterer | undefined;
    let infoWindow: google.maps.InfoWindow | undefined;

    (async () => {
      const [{ Map, InfoWindow }, { Marker }, { LatLngBounds }] = await Promise.all([
        loadMapsLibrary(),
        loadMarkerLibrary(),
        loadCoreLibrary(),
      ]);
      if (cancelled || !containerRef.current) return;

      const map = new Map(containerRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
      });

      infoWindow = new InfoWindow();

      const markers = shops.map((shop) => {
        const marker = new Marker({ position: { lat: shop.latitude, lng: shop.longitude } });
        marker.addListener("click", () => {
          infoWindow?.setContent(
            buildInfoContent(
              shop,
              (shopId) => void router.navigate({ to: "/shops/$shopId", params: { shopId } }),
            ),
          );
          infoWindow?.open({ map, anchor: marker });
        });
        return marker;
      });

      clusterer = new MarkerClusterer({ map, markers });

      if (shops.length === 1) {
        map.setCenter({ lat: shops[0].latitude, lng: shops[0].longitude });
        map.setZoom(15);
      } else if (shops.length > 1) {
        const bounds = new LatLngBounds();
        for (const shop of shops) bounds.extend({ lat: shop.latitude, lng: shop.longitude });
        map.fitBounds(bounds, 32);
      }
    })();

    return () => {
      cancelled = true;
      clusterer?.clearMarkers();
      infoWindow?.close();
    };
  }, [shops, router]);

  return <div ref={containerRef} className="size-full" />;
}
