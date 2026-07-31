import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertTriangle,
  ClipboardList,
  CreditCard,
  Download,
  IndianRupee,
  Package,
  TrendingUp,
  Truck,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageHeader } from "@/components/app-shell";
import { MonthPicker } from "@/components/month-picker";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { currentMonth, monthLabel } from "@/lib/domain";
import { inr, num } from "@/lib/format";
import { downloadCsv } from "@/lib/export";
import { labelStockSummaryQuery, productsQuery, shopsQuery, summaryQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Overview — Klinzo Operations" },
      {
        name: "description",
        content: "Monthly orders, deliveries, sales, payments, costs and profit for Klinzo at a glance.",
      },
      { property: "og:title", content: "Overview — Klinzo Operations" },
      { property: "og:description", content: "Monthly sales, payments, costs and profit at a glance." },
    ],
  }),
  component: Overview,
});

const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-primary)",
];

function Overview() {
  const [month, setMonth] = useState(currentMonth());
  const summary = useQuery(summaryQuery(month));
  const products = useQuery(productsQuery);
  const shops = useQuery(shopsQuery);
  const labelSummary = useQuery(labelStockSummaryQuery);

  const s = summary.data;
  const profit = (s?.totalSales ?? 0) - (s?.totalFixedCost ?? 0) - (s?.variableCost ?? 0);
  const due = (s?.totalSales ?? 0) - (s?.paymentsReceived ?? 0);
  const lowStockShops = (labelSummary.data ?? []).filter((r) => r.include_in_dashboard);

  const productBars = (products.data ?? []).map((p) => ({
    name: p.short_name,
    Ordered: Number(s?.orderByProduct?.[p.key] ?? 0),
    Delivered: Number(s?.deliveryByProduct?.[p.key] ?? 0),
  }));

  const costPie = [
    { name: "Production", value: 0 },
    { name: "Variable", value: s?.variableCost ?? 0 },
    { name: "Profit", value: Math.max(profit, 0) },
  ];
  costPie[0].value = s?.totalFixedCost ?? 0;

  const exportSummary = () => {
    if (!s) return;
    downloadCsv(`klinzo-overview-${month}`, [
      {
        Month: monthLabel(month),
        Orders: s.orderCount,
        "Order qty": s.orderQty,
        Deliveries: s.deliveryCount,
        "Delivered qty": s.deliveryQty,
        Sales: s.totalSales,
        "Payments received": s.paymentsReceived,
        "Payment due": due,
        "Total fixed cost": s.totalFixedCost,
        "Variable cost": s.variableCost,
        Profit: profit,
      },
    ]);
  };

  return (
    <>
      <PageHeader
        title="Overview"
        description={`Business performance for ${monthLabel(month)}`}
        actions={
          <>
            <MonthPicker value={month} onChange={setMonth} />
            <Button variant="outline" onClick={exportSummary} disabled={!s}>
              <Download className="size-4" /> Export
            </Button>
          </>
        }
      />

      {summary.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total sales" value={inr(s?.totalSales)} icon={IndianRupee} tone="accent" />
          <StatCard
            label="Profit"
            value={inr(profit)}
            sub="Sales − fixed cost − variable cost"
            icon={TrendingUp}
            tone={profit >= 0 ? "positive" : "negative"}
          />
          <StatCard
            label="Payments received"
            value={inr(s?.paymentsReceived)}
            sub={`${num(s?.paymentCount)} payments`}
            icon={CreditCard}
          />
          <StatCard label="Payment due" value={inr(due)} icon={IndianRupee} tone={due > 0 ? "negative" : "positive"} />
          <StatCard
            label="Orders"
            value={num(s?.orderCount)}
            sub={`${num(s?.orderQty)} units ordered`}
            icon={ClipboardList}
          />
          <StatCard
            label="Deliveries"
            value={num(s?.deliveryCount)}
            sub={`${num(s?.deliveryQty)} units delivered`}
            icon={Truck}
          />
          <StatCard label="Fixed cost" value={inr(s?.totalFixedCost)} sub="Production + jar/can + labelling" />
          <StatCard
            label="Labels printed"
            value={num(s?.totalLabels)}
            sub={`${num(s?.labelOrderCount)} label orders`}
            icon={Package}
          />
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="surface-card p-5 lg:col-span-2">
          <h2 className="text-base font-semibold">Ordered vs delivered by product</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={productBars}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                  }}
                />
                <Bar dataKey="Ordered" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Delivered" fill="var(--color-chart-2)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="surface-card p-5">
          <h2 className="text-base font-semibold">Where the money goes</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={costPie} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={3}>
                  {costPie.map((entry, i) => (
                    <Cell key={entry.name} fill={CHART_COLORS[i]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: number) => inr(v)}
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="surface-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Shops needing labels</h2>
            <Badge variant="secondary">{lowStockShops.length}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Shops with at least one label type below its reorder threshold.
          </p>
          <ul className="mt-4 divide-y divide-border">
            {lowStockShops.slice(0, 8).map((row) => (
              <li key={row.shop_id} className="flex items-center justify-between py-2.5 text-sm">
                <Link
                  to="/shops/$shopId"
                  params={{ shopId: row.shop_id }}
                  className="font-medium hover:text-primary"
                >
                  {row.shop_name}
                </Link>
                <span className="inline-flex items-center gap-1.5 text-xs text-warning-foreground">
                  <AlertTriangle className="size-3.5 text-warning" />
                  {row.low_stock_count} low
                </span>
              </li>
            ))}
            {lowStockShops.length === 0 && (
              <li className="py-6 text-center text-sm text-muted-foreground">All label stock is healthy.</li>
            )}
          </ul>
          <Button asChild variant="ghost" className="mt-2 w-full">
            <Link to="/labels">View label dashboard</Link>
          </Button>
        </div>

        <div className="surface-card p-5">
          <h2 className="text-base font-semibold">Quick actions</h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Button asChild variant="outline" className="justify-start">
              <Link to="/orders">
                <ClipboardList className="size-4" /> Record an order
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link to="/deliveries">
                <Truck className="size-4" /> Record a delivery
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link to="/payments">
                <CreditCard className="size-4" /> Record a payment
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link to="/import">
                <Download className="size-4" /> Import workbook
              </Link>
            </Button>
          </div>
          <div className="mt-6 rounded-lg bg-secondary p-4 text-sm">
            <p className="font-medium">{num(shops.data?.length ?? 0)} shops on file</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {num((shops.data ?? []).filter((s2) => s2.is_active).length)} active ·{" "}
              {num((shops.data ?? []).filter((s2) => !s2.is_active).length)} inactive
            </p>
          </div>
        </div>
      </div>
    </>
  );
}