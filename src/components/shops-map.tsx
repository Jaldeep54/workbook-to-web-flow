/**
 * The actual Google Maps map for "Shops on Map". Loaded lazily (see the
 * /shops/map route) so the Google Maps script only ever loads client-side.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { MarkerClusterer } from "@googlemaps/markerclusterer";

import { loadCoreLibrary, loadMapsLibrary, loadMarkerLibrary } from "@/lib/google-maps-loader";
import { googleMapsDirectionsUrl } from "@/lib/domain";
import type { Shop } from "@/lib/domain";

export type ShopWithLocation = Shop & { latitude: number; longitude: number };

const DEFAULT_CENTER = { lat: 20.5937, lng: 78.9629 }; // India, whole-country view
const DEFAULT_ZOOM = 5;

// Pin glyph is a solid black teardrop with the shop's Design Type number in
// white, drawn in a 30x30 box (Google's familiar teardrop shape, scaled 1.25x
// from the original 24x24), with a little padding around it so the white
// outline stroke doesn't get clipped.
const PIN_GLYPH_SIZE = 30;
const PIN_PADDING = 3.75;
const PIN_BOX = PIN_GLYPH_SIZE + PIN_PADDING * 2;
const LABEL_GAP = 4;
const LABEL_HEIGHT = 20;
const LABEL_PAD_X = 8;
const LABEL_RADIUS = 4;
const LABEL_BG = "#1d4ed8"; // solid blue — always this colour, regardless of Design Type
const LABEL_TEXT_COLOR = "#ffffff";
const LABEL_FONT = "700 12px ui-sans-serif, system-ui, sans-serif";
const MAX_LABEL_CHARS = 22;

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Pixel width of a label string in LABEL_FONT, used to size the name pill. */
function measureLabelWidth(text: string): number {
  if (measureCtx === undefined) {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  if (!measureCtx) return text.length * 7; // rough fallback if canvas is unavailable
  measureCtx.font = LABEL_FONT;
  return measureCtx.measureText(text).width;
}

function truncateShopName(name: string): string {
  if (name.length <= MAX_LABEL_CHARS) return name;
  return `${name.slice(0, MAX_LABEL_CHARS - 1).trimEnd()}…`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Builds a single combined icon: a coloured location pin (per Design Type)
 * with the shop name in a solid blue label box beside it. Rendered as one SVG
 * data URI so it's a normal Google Maps marker icon — no extra overlays, no
 * static HTML outside the map, and it pans/zooms with the map like any other
 * marker.
 */
function buildPinIcon(
  shop: ShopWithLocation,
  Size: typeof google.maps.Size,
  Point: typeof google.maps.Point,
): google.maps.Icon {
  const designType = String(shop.design_type);
  const label = truncateShopName(shop.shop_name);
  const pillWidth = measureLabelWidth(label) + LABEL_PAD_X * 2;

  const width = PIN_BOX + LABEL_GAP + pillWidth;
  const height = PIN_BOX;
  const pinHeadCenterY = PIN_PADDING + 11.25;
  const pillY = pinHeadCenterY - LABEL_HEIGHT / 2;
  const pillX = PIN_BOX + LABEL_GAP;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <g transform="translate(${PIN_PADDING}, ${PIN_PADDING})">
    <path d="M15 0C8.79 0 3.75 5.04 3.75 11.25c0 8.44 11.25 18.75 11.25 18.75s11.25-10.31 11.25-18.75c0-6.21-5.04-11.25-11.25-11.25z" fill="#000000" stroke="#ffffff" stroke-width="1.5"/>
    <text x="15" y="11.25" text-anchor="middle" dominant-baseline="central" font-family="ui-sans-serif, system-ui, sans-serif" font-size="14" font-weight="700" fill="#ffffff">${escapeXml(designType)}</text>
  </g>
  <rect x="${pillX}" y="${pillY}" width="${pillWidth}" height="${LABEL_HEIGHT}" rx="${LABEL_RADIUS}" fill="${LABEL_BG}"/>
  <text x="${pillX + LABEL_PAD_X}" y="${pillY + LABEL_HEIGHT / 2 + 4}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" font-weight="700" fill="${LABEL_TEXT_COLOR}">${escapeXml(label)}</text>
</svg>`;

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new Size(width, height),
    anchor: new Point(PIN_PADDING + 15, PIN_PADDING + PIN_GLYPH_SIZE),
  };
}

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
  const sizeCtorRef = useRef<typeof google.maps.Size | null>(null);
  const pointCtorRef = useRef<typeof google.maps.Point | null>(null);
  const boundsCtorRef = useRef<typeof google.maps.LatLngBounds | null>(null);
  const router = useRouter();
  const [ready, setReady] = useState(false);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ Map, InfoWindow }, { Marker }, { Size, Point, LatLngBounds }] = await Promise.all([
        loadMapsLibrary(),
        loadMarkerLibrary(),
        loadCoreLibrary(),
      ]);
      if (cancelled || !containerRef.current) return;

      markerCtorRef.current = Marker;
      sizeCtorRef.current = Size;
      pointCtorRef.current = Point;
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
    const SizeCtor = sizeCtorRef.current;
    const PointCtor = pointCtorRef.current;
    const LatLngBoundsCtor = boundsCtorRef.current;
    const infoWindow = infoWindowRef.current;
    if (!ready || !map || !MarkerCtor || !SizeCtor || !PointCtor || !LatLngBoundsCtor || !infoWindow)
      return;

    clustererRef.current?.clearMarkers();

    const markers = shops.map((shop) => {
      const marker = new MarkerCtor({
        position: { lat: shop.latitude, lng: shop.longitude },
        icon: buildPinIcon(shop, SizeCtor, PointCtor),
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
