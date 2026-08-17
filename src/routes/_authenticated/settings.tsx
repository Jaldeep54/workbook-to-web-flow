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
import { supabase } from "@/integrations/supabase/client";
import { labelProductsQuery, productsQuery } from "@/lib/queries";
import type { LabelProduct, Product } from "@/lib/domain";
import { inr } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Rates & settings — Klinzo Operations" },
      {
        name: "description",
        content:
          "Selling price, production, packaging and label rates that drive every calculation.",
      },
      { property: "og:title", content: "Rates & settings — Klinzo Operations" },
      { property: "og:description", content: "The Inputs sheet, editable and instantly applied." },
    ],
  }),
  component: SettingsPage,
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
        const { error } = await supabase
          .from("products")
          .update({
            selling_price: row.selling_price,
            production_cost: row.production_cost,
            packaging_cost: row.packaging_cost,
          })
          .eq("id", row.id);
        if (error) throw new Error(error.message);
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
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          <Save className="size-4" /> Save rates
        </Button>
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
        const { error } = await supabase
          .from("products")
          .update({ selling_price: row.selling_price })
          .eq("id", row.id);
        if (error) throw new Error(error.message);
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
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          <Save className="size-4" /> Save rates
        </Button>
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
        const { error } = await supabase
          .from("label_products")
          .update({
            labels_per_sheet: row.labels_per_sheet,
            sheet_cost: row.sheet_cost,
            low_stock_threshold: row.low_stock_threshold,
          })
          .eq("id", row.id);
        if (error) throw new Error(error.message);
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
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          <Save className="size-4" /> Save rates
        </Button>
      </div>
    </div>
  );
}
