import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Award,
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
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageHeader } from "@/components/app-shell";
import { RequirePermission } from "@/components/require-permission";
import { RESOURCES } from "@/hooks/usePermissions";
import { FinancialYearPicker } from "@/components/financial-year-picker";
import { MonthPicker } from "@/components/month-picker";
import { ShopAreaFilter } from "@/components/filter-bar";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { currentFinancialYear, currentMonth, financialYearLabel, monthLabel } from "@/lib/domain";
import { inr, inrCompact, num } from "@/lib/format";
import { downloadCsv } from "@/lib/export";
import { shopAreasQuery, shopsQuery, summaryByAreaQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/")({
  component: () => (
    <RequirePermission resource={RESOURCES.dashboard}>
      <Overview />
    </RequirePermission>
  ),
});

/** Small ₹-abbreviated label placed just outside each pie slice — tiny slices are skipped to avoid overlap. */
function renderPieLabel(props: {
  cx: number;
  cy: number;
  midAngle: number;
  outerRadius: number;
  percent: number;
  value: number;
}) {
  const { cx, cy, midAngle, outerRadius, percent, value } = props;
  if (percent < 0.04) return null;
  const RADIAN = Math.PI / 180;
  const radius = outerRadius + 14;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="var(--color-muted-foreground)"
      fontSize={11}
      textAnchor={x > cx ? "start" : "end"}
      dominantBaseline="central"
    >
      {inrCompact(value)}
    </text>
  );
}

const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-primary)",
];

function Overview() {
  const [fy, setFy] = useState(currentFinancialYear());
  const [month, setMonth] = useState(currentMonth());
  const [areaFilter, setAreaFilter] = useState("all");
  const summary = useQuery(summaryByAreaQuery(month, areaFilter));
  const shops = useQuery(shopsQuery);
  const areas = useQuery(shopAreasQuery);

  const s = summary.data;
  const profit = (s?.totalSales ?? 0) - (s?.totalFixedCost ?? 0) - (s?.variableCost ?? 0);
  /**
   * What the shops still owe: the sum of every payment's own balance, straight
   * from the API. Derived here from sales minus collections before shops could
   * pay in instalments, which double-counted a month whose deliveries and
   * collections fell either side of its edge.
   */
  const due = s?.paymentsPending ?? 0;
  const areaName =
    areaFilter === "all" ? "All Areas" : (areas.data?.find((a) => a.id === areaFilter)?.name ?? "");

  const monthlySalesBars = (s?.monthlySales ?? []).map((row) => ({
    name: monthLabel(row.month),
    Sales: row.totalSales,
  }));

  const productMixPie = (s?.productMix ?? [])
    .filter((row) => row.amount > 0)
    .map((row) => ({ name: row.shortName, value: row.amount }));

  const topShops = s?.topShops ?? [];

  const exportSummary = () => {
    if (!s) return;
    downloadCsv(`klinzo-overview-${month}`, [
      {
        "Financial year": financialYearLabel(fy),
        Month: monthLabel(month),
        Area: areaName,
        Orders: s.orderCount,
        "Order qty": s.orderQty,
        Deliveries: s.deliveryCount,
        "Delivered qty": s.deliveryQty,
        Sales: s.totalSales,
        "Payments received": s.paymentsReceived,
        "Balance pending": due,
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
        description={`Business performance for ${monthLabel(month)} (${financialYearLabel(fy)}) — ${areaName}`}
        actions={
          <>
            {/* Financial year first, then the month it scopes — the same
                order every other dated page uses. */}
            <FinancialYearPicker
              value={fy}
              onChange={(newFy, suggestedMonth) => {
                setFy(newFy);
                setMonth(suggestedMonth);
              }}
            />
            <MonthPicker value={month} onChange={setMonth} financialYear={fy} />
            <ShopAreaFilter value={areaFilter} onChange={setAreaFilter} />
            <Button variant="outline" onClick={exportSummary} disabled={!s}>
              <Download className="size-4" /> Export
            </Button>
          </>
        }
      />

      {summary.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <StatCard
            label="Total sales"
            value={inr(s?.totalSales)}
            icon={IndianRupee}
            tone="accent"
          />
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
            sub={`${num(s?.paymentCount)} bills part or fully paid`}
            icon={CreditCard}
          />
          <StatCard
            label="Balance pending"
            value={inr(due)}
            sub="Still to collect from shops"
            icon={IndianRupee}
            tone={due > 0 ? "negative" : "positive"}
          />
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
          <StatCard
            label="Fixed cost"
            value={inr(s?.totalFixedCost)}
            sub="Production + jar/can + labelling"
          />
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
          <h2 className="text-base font-semibold">Monthly sales</h2>
          <p className="text-xs text-muted-foreground">
            Last 3 months, {areaFilter === "all" ? "whole business" : areaName}
          </p>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlySalesBars}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  vertical={false}
                />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip
                  formatter={(v: number) => inr(v)}
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                  }}
                />
                <Bar dataKey="Sales" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]}>
                  <LabelList
                    dataKey="Sales"
                    position="top"
                    fontSize={11}
                    formatter={(v: number) => inrCompact(v)}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="surface-card p-5">
          <h2 className="text-base font-semibold">Sales by product</h2>
          <p className="text-xs text-muted-foreground">
            {monthLabel(month)}, {areaFilter === "all" ? "whole business" : areaName}
          </p>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={productMixPie}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={60}
                  outerRadius={95}
                  paddingAngle={3}
                  label={renderPieLabel}
                  labelLine={{ stroke: "var(--color-border)" }}
                >
                  {productMixPie.map((entry, i) => (
                    <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
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
          <h2 className="text-base font-semibold">Top 5 performing shops</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            By sales in {monthLabel(month)}, {areaFilter === "all" ? "all areas" : areaName}
          </p>
          <ul className="mt-4 divide-y divide-border">
            {topShops.map((row, i) => (
              <li key={row.shopId} className="flex items-center justify-between py-2.5 text-sm">
                <span className="flex items-center gap-2">
                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground">
                    {i + 1}
                  </span>
                  <Link
                    to="/shops/$shopId"
                    params={{ shopId: row.shopId }}
                    className="font-medium hover:text-primary"
                  >
                    {row.shopName}
                  </Link>
                </span>
                <span className="num inline-flex items-center gap-1.5 text-xs font-semibold text-success">
                  <Award className="size-3.5" />
                  {inr(row.sales)}
                </span>
              </li>
            ))}
            {topShops.length === 0 && (
              <li className="py-6 text-center text-sm text-muted-foreground">
                No delivered sales in {monthLabel(month)} yet.
              </li>
            )}
          </ul>
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
              <Link to="/cash-position">
                <IndianRupee className="size-4" /> Cash Position
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
