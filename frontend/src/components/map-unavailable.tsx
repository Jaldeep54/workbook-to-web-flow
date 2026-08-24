import { useEffect, useState } from "react";
import { MapPinOff } from "lucide-react";

import { mapsUnavailableReason, onMapsStatusChange } from "@/lib/google-maps-loader";

/**
 * Watches whether Google Maps can be used at all. Re-checks when Google
 * asynchronously rejects the key, so a map that came up blank turns into an
 * explanation instead of sitting there empty.
 */
export function useMapsUnavailableReason(): string | null {
  const [reason, setReason] = useState(() => mapsUnavailableReason());
  useEffect(() => onMapsStatusChange(() => setReason(mapsUnavailableReason())), []);
  return reason;
}

/** Shown in place of a map that cannot load, with the reason it cannot. */
export function MapUnavailable({ reason }: { reason: string }) {
  return (
    <div className="grid size-full place-items-center bg-muted/40 p-6">
      <div className="max-w-sm text-center">
        <MapPinOff className="mx-auto size-7 text-muted-foreground/60" />
        <p className="mt-3 text-sm font-medium">Map unavailable</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{reason}</p>
      </div>
    </div>
  );
}
