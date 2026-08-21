import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { RequirePermission } from "@/components/require-permission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RESOURCES } from "@/hooks/usePermissions";
import { importApi, type ImportResult } from "@/services/klinzo.service";

export const Route = createFileRoute("/_authenticated/import")({
  component: ImportPage,
});

/**
 * Excel import. The browser only uploads the workbook — parsing, matching and
 * writing all happen in the API, so the import obeys exactly the same rules
 * (and recomputes delivery figures with the same formulas) as data entered by
 * hand.
 */
function ImportPage() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const imported = await importApi.workbook(file);
      setResult(imported);
      toast.success("Workbook imported");
      void qc.invalidateQueries();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <RequirePermission resource={RESOURCES.imports} action="create">
      <PageHeader
        title="Excel import"
        description="Upload the existing workbook once — shops and the Data_* mirror tables are converted into database records."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="surface-card p-6 lg:col-span-2">
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <FileSpreadsheet className="mx-auto size-10 text-muted-foreground/70" />
            <p className="mt-3 text-sm font-medium">
              {file ? file.name : "Choose your .xlsx workbook"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Reads Shop Registry / Shop List and Data_Orders, Data_Deliveries, Data_Payments,
              Data_Labels, Data_Costs.
            </p>
            <Input
              type="file"
              accept=".xlsx,.xlsm,.xls"
              className="mx-auto mt-4 max-w-xs"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button className="mt-4" onClick={run} disabled={!file || busy}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <UploadCloud className="size-4" />
              )}{" "}
              Start import
            </Button>
            {busy && (
              <p className="mt-3 text-xs text-muted-foreground">
                Importing on the server — large workbooks can take a minute.
              </p>
            )}
          </div>

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
                  <p className="text-sm font-medium text-destructive">
                    {result.warnings.length} warnings
                  </p>
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
            <li>
              1. Shops are matched on shop code, so re-importing updates instead of duplicating.
            </li>
            <li>2. Orders and label orders are matched on shop + order number.</li>
            <li>
              3. Delivery money figures are recalculated with the rates in Settings, so they always
              agree with the workbook formulas.
            </li>
            <li>
              4. Label stock is derived automatically — printed labels minus ordered quantity.
            </li>
          </ol>
        </div>
      </div>
    </RequirePermission>
  );
}
