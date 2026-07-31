import { createFileRoute } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { productsQuery, summaryQuery, type DashboardSummary } from "@/lib/queries";
import { monthLabel, recentMonths } from "@/lib/domain";
import { inr, num } from "@/lib/format";
import { downloadCsv } from "@/lib/export";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Klinzo Operations" },
      { name: "description", content: "Month-by-month sales, profit, collections and product mix with CSV export." },
      { property: "og:title", content: "Reports — Klinzo Operations" },
      { property: "og:description", content: "Trend dashboards rebuilt from the workbook, in milliseconds." },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const [range, setRange] = useState("6");
  const months = recentMonths(Number(range)).reverse();
  const { data: products = [] } = useQuery(productsQuery);

  const results = useQueries({ queries: months.map((m) => summaryQuery(m)) });
  const loading = results.some((r) => r.isLoading);

  const rows = months.map((m, i) => {
    const s = results[i].data as DashboardSummary | undefined;
    const profit = (s?.totalSales ?? 0) - (s?.totalFixedCost ?? 0) - (s?.variableCost ?? 0);
    return {
      month: m,
      label: monthLabel(m).replace(/ \d{4}$/, ""),
      fullLabel: monthLabel(m),
      Sales: s?.totalSales ?? 0,
      Collected: s?.paymentsReceived ?? 0,
      "Fixed cost": s?.totalFixedCost ?? 0,
      "Variable cost": s?.variableCost ?? 0,
      Profit: profit,
      Orders: s?.orderCount ?? 0,
      Deliveries: s?.deliveryCount ?? 0,
      Units: s?.deliveryQty ?? 0,
      byProduct: s?.deliveryByProduct ?? {},
    };
  });

  const tooltipStyle = {
    background: "var(--color-card)",
    border: "1px solid var(--color-border)",
    borderRadius: 12,
  };

  return (
    <>
      <PageHeader
        title="Reports"
        description="Monthly trends across sales, collections, costs and product mix"
        actions={
          <>
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="w-[170px] bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">Last 3 months</SelectItem>
                <SelectItem value="6">Last 6 months</SelectItem>
                <SelectItem value="12">Last 12 months</SelectItem>
                <SelectItem value="24">Last 24 months</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={loading}
              onClick={() =>
                downloadCsv(
                  `klinzo-report-${range}m`,
                  rows.map((r) => ({
                    Month: r.fullLabel,
                    Orders: r.Orders,
                    Deliveries: r.Deliveries,
                    Units: r.Units,
                    Sales: r.Sales,
                    Collected: r.Collected,
                    "Fixed cost": r["Fixed cost"],
                    "Variable cost": r["Variable cost"],
                    Profit: r.Profit,
                    ...Object.fromEntries(products.map((p) => [p.short_name, r.byProduct[p.key] ?? 0])),
                  })),
                )
              }
            >
              <Download className="size-4" /> Export
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="surface-card p-5">
          <h2 className="text-base font-semibold">Sales vs profit</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows}>
                <defs>
                  <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip formatter={(v: number) => inr(v)} contentStyle={tooltipStyle} />
                <Area dataKey="Sales" stroke="var(--color-chart-1)" fill="url(#salesFill)" strokeWidth={2} />
                <Line dataKey="Profit" stroke="var(--color-chart-2)" strokeWidth={2} dot={false} />
                <Legend />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="surface-card p-5">
          <h2 className="text-base font-semibold">Collections vs sales</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip formatter={(v: number) => inr(v)} contentStyle={tooltipStyle} />
                <Legend />
                <Bar dataKey="Sales" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Collected" fill="var(--color-chart-3)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="surface-card p-5 lg:col-span-2">
          <h2 className="text-base font-semibold">Units delivered</h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line dataKey="Units" stroke="var(--color-chart-4)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="surface-card mt-6 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead className="text-right">Orders</TableHead>
              <TableHead className="text-right">Deliveries</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead className="text-right">Sales</TableHead>
              <TableHead className="text-right">Collected</TableHead>
              <TableHead className="text-right">Fixed cost</TableHead>
              <TableHead className="text-right">Variable</TableHead>
              <TableHead className="text-right">Profit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...rows].reverse().map((r) => (
              <TableRow key={r.month}>
                <TableCell className="font-medium">{r.fullLabel}</TableCell>
                <TableCell className="num text-right">{num(r.Orders)}</TableCell>
                <TableCell className="num text-right">{num(r.Deliveries)}</TableCell>
                <TableCell className="num text-right">{num(r.Units)}</TableCell>
                <TableCell className="num text-right">{inr(r.Sales)}</TableCell>
                <TableCell className="num text-right">{inr(r.Collected)}</TableCell>
                <TableCell className="num text-right">{inr(r["Fixed cost"])}</TableCell>
                <TableCell className="num text-right">{inr(r["Variable cost"])}</TableCell>
                <TableCell
                  className={`num text-right font-semibold ${r.Profit >= 0 ? "text-success" : "text-destructive"}`}
                >
                  {inr(r.Profit)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}