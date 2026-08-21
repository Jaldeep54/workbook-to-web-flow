import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RequirePermission } from "@/components/require-permission";
import { Can, RESOURCES } from "@/hooks/usePermissions";
import { labelProductsApi, productsApi } from "@/services/klinzo.service";
import { labelProductsQuery, productsQuery } from "@/lib/queries";
import type { LabelProduct, Product } from "@/lib/domain";
import { inr } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/settings")({
  component: () => (
    <RequirePermission resource={RESOURCES.products}>
      <SettingsPage />
    </RequirePermission>
  ),
});

function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Rates & settings"
        description="These are the workbook's Inputs sheet values. Changing them affects new deliveries only — past deliveries keep their frozen figures."
      />
      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">Product rates</TabsTrigger>
          <TabsTrigger value="labels">Label rates</TabsTrigger>
          <TabsTrigger value="sales">Sales rates</TabsTrigger>
        </TabsList>
        <TabsContent value="products" className="pt-4">
          <ProductRates />
        </TabsContent>
        <TabsContent value="labels" className="pt-4">
          <LabelRates />
        </TabsContent>
        <TabsContent value="sales" className="pt-4">
          <SalesRates />
        </TabsContent>
      </Tabs>
    </>
  );
}

function ProductRates() {
  const qc = useQueryClient();
  const { data = [] } = useQuery(productsQuery);
  const [rows, setRows] = useState<Product[]>([]);
  useEffect(() => setRows(data), [data]);

  const save = useMutation({
    mutationFn: async () => {
      for (const row of rows) {
        await productsApi.update(row.id, {
          selling_price: row.selling_price,
          production_cost: row.production_cost,
          packaging_cost: row.packaging_cost,
        });
      }
    },
    onSuccess: () => {
      toast.success("Product rates saved");
      void qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = (id: string, key: keyof Product, value: number) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [key]: value } : r)));

  return (
    <div className="surface-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Selling price</TableHead>
            <TableHead className="text-right">Production</TableHead>
            <TableHead className="text-right">Jar & can</TableHead>
            <TableHead className="text-right">Label / unit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.name}</TableCell>
              {(["selling_price", "production_cost", "packaging_cost"] as const).map((key) => (
                <TableCell key={key} className="text-right">
                  <Input
                    type="number"
                    step="0.01"
                    className="num ml-auto w-28 text-right"
                    value={p[key]}
                    onChange={(e) => set(p.id, key, Number(e.target.value))}
                  />
                </TableCell>
              ))}
              <TableCell
                className="num text-right text-muted-foreground"
                title="Sum of sheet cost ÷ labels per sheet across this product's labels — edit under the Label rates tab."
              >
                {inr(p.label_cost_per_unit, 2)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="border-t border-border p-3 text-right">
        <Can resource={RESOURCES.products} action="update">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="size-4" /> Save rates
          </Button>
        </Can>
      </div>
    </div>
  );
}

/**
 * Sales / unit — the same products.selling_price column the Product rates tab
 * already edits (and computeDeliveryTotals already uses for totalSales), just
 * in a dedicated, product-name-focused view. No new field: one source of
 * truth, two editing surfaces.
 */
function SalesRates() {
  const qc = useQueryClient();
  const { data = [] } = useQuery(productsQuery);
  const [rows, setRows] = useState<Product[]>([]);
  useEffect(() => setRows(data), [data]);

  const save = useMutation({
    mutationFn: async () => {
      for (const row of rows) {
        await productsApi.update(row.id, { selling_price: row.selling_price });
      }
    },
    onSuccess: () => {
      toast.success("Sales rates saved");
      void qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = (id: string, value: number) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, selling_price: value } : r)));

  return (
    <div className="surface-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Sales / unit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.name}</TableCell>
              <TableCell className="text-right">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  className="num ml-auto w-28 text-right"
                  value={p.selling_price}
                  onChange={(e) => set(p.id, Number(e.target.value))}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="border-t border-border p-3 text-right">
        <Can resource={RESOURCES.products} action="update">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="size-4" /> Save rates
          </Button>
        </Can>
      </div>
    </div>
  );
}

function LabelRates() {
  const qc = useQueryClient();
  const { data = [] } = useQuery(labelProductsQuery);
  const [rows, setRows] = useState<LabelProduct[]>([]);
  useEffect(() => setRows(data), [data]);

  const save = useMutation({
    mutationFn: async () => {
      for (const row of rows) {
        await labelProductsApi.update(row.id, {
          labels_per_sheet: row.labels_per_sheet,
          sheet_cost: row.sheet_cost,
          low_stock_threshold: row.low_stock_threshold,
        });
      }
    },
    onSuccess: () => {
      toast.success("Label rates saved");
      void qc.invalidateQueries({ queryKey: ["label_products"] });
      void qc.invalidateQueries({ queryKey: ["label_stock"] });
      void qc.invalidateQueries({ queryKey: ["label_stock_summary"] });
      // The database recalculates each product's Label / unit from these rates —
      // refetch so the Product rates tab picks up the new figure immediately.
      void qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = (id: string, key: keyof LabelProduct, value: number) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [key]: value } : r)));

  return (
    <div className="surface-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Label</TableHead>
            <TableHead className="text-right">Labels per sheet</TableHead>
            <TableHead className="text-right">Sheet cost</TableHead>
            <TableHead className="text-right">Low stock below</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((lp) => (
            <TableRow key={lp.id}>
              <TableCell className="font-medium">{lp.name}</TableCell>
              {(["labels_per_sheet", "sheet_cost", "low_stock_threshold"] as const).map((key) => (
                <TableCell key={key} className="text-right">
                  <Input
                    type="number"
                    step="0.01"
                    className="num ml-auto w-28 text-right"
                    value={lp[key]}
                    onChange={(e) => set(lp.id, key, Number(e.target.value))}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="border-t border-border p-3 text-right">
        <Can resource={RESOURCES.labelProducts} action="update">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="size-4" /> Save rates
          </Button>
        </Can>
      </div>
    </div>
  );
}
