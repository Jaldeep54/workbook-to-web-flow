import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useMemo, useState } from "react";
import { MapPin } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { RequirePermission } from "@/components/require-permission";
import { RESOURCES } from "@/hooks/usePermissions";
import { ShopAreaFilter } from "@/components/filter-bar";
import { shopsQuery } from "@/lib/queries";
import type { ShopWithLocation } from "@/components/shops-map";

const ShopsMap = lazy(() => import("@/components/shops-map"));

export const Route = createFileRoute("/_authenticated/shops/map")({
  component: () => (
    <RequirePermission resource={RESOURCES.shops}>
      <ShopsMapPage />
    </RequirePermission>
  ),
});

function MapFallback() {
  return (
    <div className="grid h-full place-items-center bg-muted/40 text-sm text-muted-foreground">
      Loading map…
    </div>
  );
}

function ShopsMapPage() {
  const { data: shops = [], isLoading } = useQuery(shopsQuery);
  const [areaFilter, setAreaFilter] = useState("all");

  const located = useMemo(
    () => shops.filter((s): s is ShopWithLocation => s.latitude != null && s.longitude != null),
    [shops],
  );
  const filtered = useMemo(
    () => (areaFilter === "all" ? located : located.filter((s) => s.area_id === areaFilter)),
    [located, areaFilter],
  );

  return (
    <>
      <PageHeader
        title="Shops on map"
        description={
          isLoading
            ? "Loading shops…"
            : `${filtered.length} of ${located.length} located shops shown — ${shops.length - located.length} shops don't have a saved location`
        }
        actions={<ShopAreaFilter value={areaFilter} onChange={setAreaFilter} />}
      />

      <div className="surface-card h-[70vh] min-h-96 overflow-hidden">
        {!isLoading && filtered.length === 0 ? (
          <div className="grid h-full place-items-center px-4 text-center">
            <div>
              <MapPin className="mx-auto size-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm text-muted-foreground">
                {located.length === 0
                  ? "No shops have a saved location yet. Add one from a shop's edit form."
                  : "No shops with a saved location in this area."}
              </p>
            </div>
          </div>
        ) : (
          <Suspense fallback={<MapFallback />}>
            <ClientOnly fallback={<MapFallback />}>
              <ShopsMap shops={filtered} />
            </ClientOnly>
          </Suspense>
        )}
      </div>
    </>
  );
}
