import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download, Lightbulb, Search } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { ProductChips } from "@/components/product-multi-select";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { skuOpportunityQuery } from "@/lib/queries";
import { inr } from "@/lib/format";
import { downloadCsv } from "@/lib/export";

export const Route = createFileRoute("/_authenticated/sku-opportunity")({
  head: () => ({
    meta: [
      { title: "SKU opportunity — Klinzo Operations" },
      {
        name: "description",
        content: "See which of the six Klinzo products each shop already sells and which ones can still be introduced.",
      },
      { property: "og:title", content: "SKU opportunity — Klinzo Operations" },
      { property: "og:description", content: "Spot cross-sell opportunities shop by shop." },
    ],
  }),
  component: SkuOpportunityPage,
});

function SkuOpportunityPage() {
  const { data: rows = [], isLoading } = useQuery(skuOpportunityQuery);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.shop_name, r.label_name, r.address].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const withGaps = rows.filter((r) => (r.inactive_products ?? []).length > 0);
  const potential = withGaps.reduce((a, r) => a + Number(r.avg_monthly_sales), 0);

  return (
    <>
      <PageHeader
        title="SKU opportunity"
        description="Products each shop already sells versus the ones still open to introduce"
        actions={
          <Button
            variant="outline"
            onClick={() =>
              downloadCsv(
                "klinzo-sku-opportunity",
                filtered.map((r, i) => ({
                  "S. No.": i + 1,
                  Shop: r.shop_name,
                  "Label name": r.label_name ?? "",
                  Address: r.address ?? "",
                  "Active products": (r.active_products ?? []).join(", "),
                  "Inactive products": (r.inactive_products ?? []).join(", "),
                  "Avg monthly sales": Number(r.avg_monthly_sales),
                })),
              )
            }
          >
            <Download className="size-4" /> Export
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Shops tracked" value={String(rows.length)} />
        <StatCard label="Shops with open SKUs" value={String(withGaps.length)} icon={Lightbulb} tone="accent" />
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
                <TableHead>Address</TableHead>
                <TableHead>Active products</TableHead>
                <TableHead>Inactive products</TableHead>
                <TableHead className="text-right">Avg monthly sales</TableHead>
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
                    No shops match that search.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((r, i) => (
                <TableRow key={r.shop_id}>
                  <TableCell className="num text-right text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    <Link to="/shops/$shopId" params={{ shopId: r.shop_id }} className="font-medium hover:text-primary">
                      {r.shop_name}
                    </Link>
                    {r.label_name && <p className="text-xs text-muted-foreground">{r.label_name}</p>}
                  </TableCell>
                  <TableCell className="max-w-[16rem] text-sm text-muted-foreground">{r.address ?? "—"}</TableCell>
                  <TableCell>
                    <ProductChips names={r.active_products ?? []} />
                  </TableCell>
                  <TableCell>
                    <ProductChips names={r.inactive_products ?? []} />
                  </TableCell>
                  <TableCell className="num text-right font-semibold">{inr(r.avg_monthly_sales)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
}