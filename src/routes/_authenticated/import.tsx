import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labelProductsQuery, productsQuery } from "@/lib/queries";
import { importWorkbook, type ImportResult } from "@/lib/import-workbook";

export const Route = createFileRoute("/_authenticated/import")({
  head: () => ({
    meta: [
      { title: "Excel import — Klinzo Operations" },
      { name: "description", content: "Upload the Klinzo workbook to migrate shops, orders, deliveries, payments and labels." },
      { property: "og:title", content: "Excel import — Klinzo Operations" },
      { property: "og:description", content: "One-step migration from the existing spreadsheet." },
    ],
  }),
  component: ImportPage,
});

function ImportPage() {
  const qc = useQueryClient();
  const { data: products = [] } = useQuery(productsQuery);
  const { data: labelProducts = [] } = useQuery(labelProductsQuery);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setResult(null);
    setStatus([]);
    try {
      const res = await importWorkbook(file, products, labelProducts, (m) =>
        setStatus((prev) => [...prev, m]),
      );
      setResult(res);
      toast.success("Workbook imported");
      void qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Excel import"
        description="Upload the existing workbook once — shops and the Data_* mirror tables are converted into database records."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="surface-card p-6 lg:col-span-2">
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <FileSpreadsheet className="mx-auto size-10 text-muted-foreground/70" />
            <p className="mt-3 text-sm font-medium">{file ? file.name : "Choose your .xlsx workbook"}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Reads Shop Registry / Shop List and Data_Orders, Data_Deliveries, Data_Payments, Data_Labels, Data_Costs.
            </p>
            <Input
              type="file"
              accept=".xlsx,.xlsm,.xls"
              className="mx-auto mt-4 max-w-xs"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button className="mt-4" onClick={run} disabled={!file || busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />} Start import
            </Button>
          </div>

          {status.length > 0 && (
            <ul className="mt-6 space-y-1 text-sm text-muted-foreground">
              {status.map((s, i) => (
                <li key={i}>• {s}</li>
              ))}
            </ul>
          )}

          {result && (
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                ["Shops", result.shops],
                ["Orders", result.orders],
                ["Deliveries", result.deliveries],
                ["Payments", result.payments],
                ["Label orders", result.labelOrders],
                ["Variable costs", result.costs],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg bg-secondary p-4">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="num text-lg font-semibold">{value}</p>
                </div>
              ))}
              {result.warnings.length > 0 && (
                <div className="sm:col-span-3">
                  <p className="text-sm font-medium text-destructive">{result.warnings.length} warnings</p>
                  <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                    {result.warnings.slice(0, 50).map((w, i) => (
                      <li key={i}>• {w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="surface-card p-6">
          <h2 className="text-base font-semibold">How the migration works</h2>
          <ol className="mt-3 space-y-3 text-sm text-muted-foreground">
            <li>1. Shops are matched on shop code, so re-importing updates instead of duplicating.</li>
            <li>2. Orders and label orders are matched on shop + order number.</li>
            <li>3. Delivery money figures are recalculated with the rates in Settings, so they always agree with the workbook formulas.</li>
            <li>4. Label stock is derived automatically — printed labels minus ordered quantity.</li>
          </ol>
        </div>
      </div>
    </>
  );
}