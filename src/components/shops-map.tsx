/**
 * The actual Google Maps map for "Shops on Map". Loaded lazily (see the
 * /shops/map route) so the Google Maps script only ever loads client-side.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { MarkerClusterer } from "@googlemaps/markerclusterer";

import { loadCoreLibrary, loadMapsLibrary, loadMarkerLibrary } from "@/lib/google-maps-loader";
import { designTypeColor, googleMapsDirectionsUrl } from "@/lib/domain";
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

  const design = document.createElement("p");
  design.className = "text-sm text-muted-foreground";
  design.textContent = `Design type: ${shop.design_type}`;
  root.appendChild(design);

  const actions = document.createElement("div");
  actions.className = "mt-2 flex gap-2";

  const directions = document.createElement("a");
  directions.href = googleMapsDirectionsUrl(shop.latitude, shop.longitude);
  directions.target = "_blank";
  directions.rel = "noreferrer";
  directions.textContent = "Get Direction";
  directions.className =
    "inline-flex h-8 flex-1 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent";
  actions.appendChild(directions);

  const viewShop = document.createElement("button");
  viewShop.type = "button";
  viewShop.textContent = "View shop";
  viewShop.className =
    "inline-flex h-8 flex-1 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90";
  viewShop.addEventListener("click", () => onViewShop(shop.id));
  actions.appendChild(viewShop);

  root.appendChild(actions);
  return root;
}

export default function ShopsMapInner({ shops }: { shops: ShopWithLocation[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const markerCtorRef = useRef<typeof google.maps.Marker | null>(null);
  const symbolPathRef = useRef<typeof google.maps.SymbolPath | null>(null);
  const boundsCtorRef = useRef<typeof google.maps.LatLngBounds | null>(null);
  const router = useRouter();
  const [ready, setReady] = useState(false);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ Map, InfoWindow }, { Marker }, { SymbolPath, LatLngBounds }] = await Promise.all([
        loadMapsLibrary(),
        loadMarkerLibrary(),
        loadCoreLibrary(),
      ]);
      if (cancelled || !containerRef.current) return;

      markerCtorRef.current = Marker;
      symbolPathRef.current = SymbolPath;
      boundsCtorRef.current = LatLngBounds;

      mapRef.current = new Map(containerRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        streetViewControl: false,
        mapTypeControl: true, // lets the user switch between normal and satellite view
        fullscreenControl: false,
      });
      infoWindowRef.current = new InfoWindow();
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Rebuild markers whenever the (possibly area-filtered) shop list changes.
  useEffect(() => {
    const map = mapRef.current;
    const MarkerCtor = markerCtorRef.current;
    const SymbolPath = symbolPathRef.current;
    const LatLngBoundsCtor = boundsCtorRef.current;
    const infoWindow = infoWindowRef.current;
    if (!ready || !map || !MarkerCtor || !SymbolPath || !LatLngBoundsCtor || !infoWindow) return;

    clustererRef.current?.clearMarkers();

    const markers = shops.map((shop) => {
      const marker = new MarkerCtor({
        position: { lat: shop.latitude, lng: shop.longitude },
        icon: {
          path: SymbolPath.CIRCLE,
          scale: 8,
          fillColor: designTypeColor(shop.design_type),
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });
      marker.addListener("click", () => {
        infoWindow.setContent(
          buildInfoContent(
            shop,
            (shopId) => void router.navigate({ to: "/shops/$shopId", params: { shopId } }),
          ),
        );
        infoWindow.open({ map, anchor: marker });
      });
      return marker;
    });

    clustererRef.current = new MarkerClusterer({ map, markers });

    if (shops.length === 1) {
      map.setCenter({ lat: shops[0].latitude, lng: shops[0].longitude });
      map.setZoom(15);
    } else if (shops.length > 1) {
      const bounds = new LatLngBoundsCtor();
      for (const shop of shops) bounds.extend({ lat: shop.latitude, lng: shop.longitude });
      map.fitBounds(bounds, 32);
    }

    return () => {
      clustererRef.current?.clearMarkers();
      infoWindow.close();
    };
  }, [ready, shops, router]);

  return <div ref={containerRef} className="size-full" />;
}
