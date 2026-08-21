import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Lightbulb, Search } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { RequirePermission } from "@/components/require-permission";
import { RESOURCES } from "@/hooks/usePermissions";
import { ProductChips } from "@/components/product-multi-select";
import { ShopAreaFilter } from "@/components/filter-bar";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { shopAreasQuery, shopsQuery, skuOpportunityQuery } from "@/lib/queries";
import { inr } from "@/lib/format";
import { downloadCsv } from "@/lib/export";

export const Route = createFileRoute("/_authenticated/sku-opportunity")({
  component: () => (
    <RequirePermission resource={RESOURCES.skuOpportunity}>
      <SkuOpportunityPage />
    </RequirePermission>
  ),
});

type SalesSort = "none" | "desc" | "asc";

function SkuOpportunityPage() {
  const { data: rows = [], isLoading } = useQuery(skuOpportunityQuery);
  const { data: shops = [] } = useQuery(shopsQuery);
  const { data: areas = [] } = useQuery(shopAreasQuery);
  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState("all");
  const [salesSort, setSalesSort] = useState<SalesSort>("none");

  const areaByShop = useMemo(() => {
    const shopArea = new Map(shops.map((s) => [s.id, s.area_id]));
    const areaName = new Map(areas.map((a) => [a.id, a.name]));
    return (shopId: string) => {
      const areaId = shopArea.get(shopId);
      return areaId ? (areaName.get(areaId) ?? "Not Assigned") : "Not Assigned";
    };
  }, [shops, areas]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows;
    if (areaFilter !== "all") {
      const shopIdsInArea = new Set(shops.filter((s) => s.area_id === areaFilter).map((s) => s.id));
      out = out.filter((r) => shopIdsInArea.has(r.shop_id));
    }
    if (q) {
      out = out.filter((r) =>
        [r.shop_name, r.label_name, r.address]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    if (salesSort !== "none") {
      out = [...out].sort((a, b) => {
        const diff = Number(a.avg_monthly_sales) - Number(b.avg_monthly_sales);
        return salesSort === "desc" ? -diff : diff;
      });
    }
    return out;
  }, [rows, shops, search, areaFilter, salesSort]);

  const withGaps = rows.filter((r) => (r.inactive_products ?? []).length > 0);
  const potential = withGaps.reduce((a, r) => a + Number(r.avg_monthly_sales), 0);

  const cycleSalesSort = () =>
    setSalesSort((s) => (s === "none" ? "desc" : s === "desc" ? "asc" : "none"));

  return (
    <>
      <PageHeader
        title="SKU opportunity"
        description="Products each shop already sells versus the ones still open to introduce"
        actions={
          <>
            <ShopAreaFilter value={areaFilter} onChange={setAreaFilter} />
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(
                  "klinzo-sku-opportunity",
                  filtered.map((r, i) => ({
                    "S. No.": i + 1,
                    Shop: r.shop_name,
                    "Label name": r.label_name ?? "",
                    Area: areaByShop(r.shop_id),
                    "Active products": (r.active_products ?? []).join(", "),
                    "Inactive products": (r.inactive_products ?? []).join(", "),
                    "Avg monthly sales": Number(r.avg_monthly_sales),
                  })),
                )
              }
            >
              <Download className="size-4" /> Export
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Shops tracked" value={String(rows.length)} />
        <StatCard
          label="Shops with open SKUs"
          value={String(withGaps.length)}
          icon={Lightbulb}
          tone="accent"
        />
        <StatCard
          label="Avg monthly sales in those shops"
          value={inr(potential)}
          sub="Existing run-rate of shops with room to grow"
        />
      </div>

      <div className="surface-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <Search className="size-4 text-muted-foreground" />
          <Input
            placeholder="Search shop, label name or address…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14 text-right">S. No.</TableHead>
                <TableHead>Shop name</TableHead>
                <TableHead>Shop Area</TableHead>
                <TableHead>Active products</TableHead>
                <TableHead>Inactive products</TableHead>
                <TableHead className="text-right">
                  <button
                    type="button"
                    onClick={cycleSalesSort}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    Avg monthly sales
                    {salesSort === "none" && <ArrowUpDown className="size-3.5" />}
                    {salesSort === "desc" && <ArrowDown className="size-3.5" />}
                    {salesSort === "asc" && <ArrowUp className="size-3.5" />}
                  </button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Building opportunity list…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                    No shops match the current filters.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((r, i) => (
                <TableRow key={r.shop_id}>
                  <TableCell className="num text-right text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    <Link
                      to="/shops/$shopId"
                      params={{ shopId: r.shop_id }}
                      className="font-medium hover:text-primary"
                    >
                      {r.shop_name}
                    </Link>
                    {r.label_name && (
                      <p className="text-xs text-muted-foreground">{r.label_name}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {areaByShop(r.shop_id)}
                  </TableCell>
                  <TableCell>
                    <ProductChips names={r.active_products ?? []} />
                  </TableCell>
                  <TableCell>
                    <ProductChips names={r.inactive_products ?? []} />
                  </TableCell>
                  <TableCell className="num text-right font-semibold">
                    {inr(r.avg_monthly_sales)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
}
