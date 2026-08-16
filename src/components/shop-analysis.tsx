import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ProductChips } from "@/components/product-multi-select";
import { StatCard } from "@/components/stat-card";
import { shopAnalysisQuery, type ShopAnalysis, type ShopAnalysisMixRow } from "@/lib/queries";
import { inr } from "@/lib/format";

const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

const tooltipStyle = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 12,
};

/** Same colour for the same product across both pie charts (and stable across renders). */
function buildProductColorMap(data: ShopAnalysis): Map<string, string> {
  const sortOrderById = new Map<string, number>();
  const record = (rows: Array<{ productId?: string; id?: string; sortOrder: number }>) => {
    for (const r of rows) {
      const id = r.productId ?? r.id;
      if (id && !sortOrderById.has(id)) sortOrderById.set(id, r.sortOrder);
    }
  };
  record(data.activeProducts);
  record(data.productMix.shop);
  record(data.productMix.area);
  record(data.monthlySales.shop?.byProduct ?? []);
  record(data.monthlySales.area?.byProduct ?? []);

  const ordered = [...sortOrderById.entries()].sort((a, b) => a[1] - b[1]);
  const map = new Map<string, string>();
  ordered.forEach(([id], i) => map.set(id, CHART_COLORS[i % CHART_COLORS.length]));
  return map;
}

function ProductMixPie({
  title,
  rows,
  colorMap,
  emptyMessage,
}: {
  title: string;
  rows: ShopAnalysisMixRow[];
  colorMap: Map<string, string>;
  emptyMessage: string;
}) {
  return (
    <div className="surface-card p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <div className="mt-4 grid h-64 place-items-center text-center text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      ) : (
        <div className="mt-2 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={rows}
                dataKey="sharePct"
                nameKey="shortName"
                innerRadius={52}
                outerRadius={82}
                paddingAngle={2}
              >
                {rows.map((r) => (
                  <Cell key={r.productId} fill={colorMap.get(r.productId)} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, name: string) => [`${Number(value).toFixed(1)}%`, name]}
                contentStyle={tooltipStyle}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/** Shop Analysis: product mix, order frequency and monthly sales, this shop vs its Shop Area peers. */
export function ShopAnalysisTab({ shopId }: { shopId: string }) {
  const { data, isLoading, error } = useQuery(shopAnalysisQuery(shopId));

  if (isLoading) {
    return (
      <div className="surface-card grid h-64 place-items-center text-sm text-muted-foreground">
        Crunching shop analysis…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="surface-card grid h-64 place-items-center text-sm text-muted-foreground">
        Couldn't load shop analysis.
      </div>
    );
  }

  const colorMap = buildProductColorMap(data);
  const hasArea = !!data.shop.areaId;
  const hasOrders = data.productMix.shop.length > 0 || (data.orderFrequency.shop?.orderCount ?? 0) > 0;

  const salesRows = data.activeProducts.map((p) => ({
    shortName: p.shortName,
    sortOrder: p.sortOrder,
    "This Shop": data.monthlySales.shop?.byProduct.find((r) => r.productId === p.id)?.average ?? 0,
    "Area Average": data.monthlySales.area?.byProduct.find((r) => r.productId === p.id)?.average ?? 0,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Compared against active shops in <span className="font-medium">{data.shop.areaName ?? "—"}</span>
        </p>
        <p className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
          Analysis Period: {data.analysisPeriod.label}
        </p>
      </div>

      <div className="surface-card p-5">
        <h3 className="text-sm font-semibold">Active Products</h3>
        <div className="mt-3">
          {data.activeProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No products assigned to this shop.</p>
          ) : (
            <ProductChips names={data.activeProducts.map((p) => p.shortName)} />
          )}
        </div>
      </div>

      {!hasOrders ? (
        <div className="surface-card grid h-32 place-items-center text-sm text-muted-foreground">
          No orders available for analysis.
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <ProductMixPie
              title="Product Mix — This Shop"
              rows={data.productMix.shop}
              colorMap={colorMap}
              emptyMessage="No orders in this period."
            />
            <ProductMixPie
              title="Product Mix — Area Average"
              rows={data.productMix.area}
              colorMap={colorMap}
              emptyMessage={
                !hasArea
                  ? "Assign a Shop Area to enable area comparison."
                  : "Not enough shops/orders in this area for comparison."
              }
            />
          </div>

          <div className="surface-card p-5">
            <h3 className="text-sm font-semibold">Order Frequency</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {data.orderFrequency.shop ? (
                <StatCard
                  label="This shop"
                  value={`${data.orderFrequency.shop.avgDays} days`}
                  sub={`${data.orderFrequency.shop.orderCount} orders in period`}
                />
              ) : (
                <StatCard label="This shop" value="Insufficient data" sub="At least 2 orders are required" />
              )}
              {data.orderFrequency.area ? (
                <StatCard
                  label="Area average"
                  value={`${data.orderFrequency.area.avgDays} days`}
                  sub={
                    data.orderFrequency.shop
                      ? orderFrequencyComparisonLabel(
                          data.orderFrequency.shop.avgDays,
                          data.orderFrequency.area.avgDays,
                        )
                      : `Across ${data.orderFrequency.area.eligibleShops} shops`
                  }
                />
              ) : (
                <StatCard
                  label="Area average"
                  value="—"
                  sub={!hasArea ? "Shop area not assigned" : "Not enough shops/orders in this area"}
                />
              )}
            </div>
          </div>

          <div className="surface-card p-5">
            <h3 className="text-sm font-semibold">Average Monthly Sales</h3>
            {!data.monthlySales.shop ? (
              <div className="mt-4 grid h-48 place-items-center text-sm text-muted-foreground">
                No delivered sales in this period.
              </div>
            ) : (
              <div className="mt-4" style={{ height: Math.max(220, salesRows.length * 48) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={salesRows} layout="vertical" margin={{ left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                    <XAxis type="number" tickLine={false} axisLine={false} fontSize={12} tickFormatter={(v) => inr(v)} />
                    <YAxis type="category" dataKey="shortName" tickLine={false} axisLine={false} fontSize={12} width={90} />
                    <Tooltip formatter={(v: number) => inr(v)} contentStyle={tooltipStyle} />
                    <Legend />
                    <Bar dataKey="This Shop" fill="var(--color-chart-1)" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="Area Average" fill="var(--color-chart-3)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function orderFrequencyComparisonLabel(shopDays: number, areaDays: number): string {
  const diff = areaDays - shopDays; // positive = shop orders more often than area
  if (Math.abs(diff) < 0.1) return "Same as area average";
  return diff > 0
    ? `Ordering ${diff.toFixed(1)} days more frequently than area average`
    : `Ordering ${Math.abs(diff).toFixed(1)} days less frequently than area average`;
}
