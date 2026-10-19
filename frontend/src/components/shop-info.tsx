import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CreditCard,
  Truck,
} from "lucide-react";

import { ShopAnalysisTab } from "@/components/shop-analysis";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RESOURCES, usePermissions } from "@/hooks/usePermissions";
import { productsQuery } from "@/lib/queries";
import { dateLabel, inr, num } from "@/lib/format";
import { fieldOpsApi, shopsApi } from "@/services/klinzo.service";

/**
 * Shop Info — the four view-only options a shop opens to from Field
 * Operations (tapping a shop in the Shops List, or "Shop Info" on New Order):
 * Orders, Deliveries, Payments and Shop Analysis.
 *
 * Built for a phone first: one option list, each opening a single column of
 * cards with a back button, all inside one dialog.
 */
export type ShopInfoView = "orders" | "deliveries" | "payments" | "analysis";

const OPTIONS: Array<{ view: ShopInfoView; label: string; icon: typeof Truck; hint: string }> = [
  { view: "orders", label: "Orders", icon: ClipboardList, hint: "Every order this shop placed" },
  { view: "deliveries", label: "Deliveries", icon: Truck, hint: "Delivery date, products, bill" },
  { view: "payments", label: "Payments", icon: CreditCard, hint: "Pending and collected" },
  { view: "analysis", label: "Shop Analysis", icon: BarChart3, hint: "Product mix and sales" },
];

type Line = { product_id: string; qty: number };

export function ShopInfoDialog({
  shopId,
  shopName,
  open,
  onOpenChange,
}: {
  shopId: string | null;
  shopName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [view, setView] = useState<ShopInfoView | null>(null);
  const current = OPTIONS.find((o) => o.view === view);

  return (
    <Dialog
      open={open && !!shopId}
      onOpenChange={(next) => {
        if (!next) setView(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="text-left">
          <div className="flex items-center gap-2">
            {view && (
              <Button
                variant="ghost"
                size="icon"
                className="-ml-2 shrink-0"
                onClick={() => setView(null)}
                aria-label="Back to shop options"
              >
                <ChevronLeft className="size-5" />
              </Button>
            )}
            <div className="min-w-0">
              <DialogTitle className="truncate">{current?.label ?? "Shop info"}</DialogTitle>
              {shopName && <p className="truncate text-xs text-muted-foreground">{shopName}</p>}
            </div>
          </div>
        </DialogHeader>
        {shopId && !view && (
          <div className="grid gap-2">
            {OPTIONS.map((o) => (
              <button
                key={o.view}
                type="button"
                onClick={() => setView(o.view)}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-secondary/60 active:bg-secondary"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary">
                  <o.icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{o.label}</span>
                  <span className="block text-xs text-muted-foreground">{o.hint}</span>
                </span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
        {shopId && view && view !== "analysis" && <ShopInfoList shopId={shopId} view={view} />}
        {shopId && view === "analysis" && <ShopAnalysisTab shopId={shopId} />}
      </DialogContent>
    </Dialog>
  );
}

function ShopInfoList({
  shopId,
  view,
}: {
  shopId: string;
  view: Exclude<ShopInfoView, "analysis">;
}) {
  const { can } = usePermissions();
  const { data: products = [] } = useQuery(productsQuery);
  const history = useQuery({
    queryKey: ["shop_history", shopId],
    queryFn: () => shopsApi.history(shopId),
  });
  const collections = useQuery({
    queryKey: ["field_collections", shopId],
    queryFn: () => fieldOpsApi.collections(shopId),
    enabled: view === "payments" && can(RESOURCES.fieldOperations, "view"),
  });

  const describe = useMemo(() => {
    const sorted = [...products].sort((a, b) => a.sort_order - b.sort_order);
    return (lines: Line[] | undefined) =>
      sorted
        .map((p) => ({ p, qty: (lines ?? []).find((l) => l.product_id === p.id)?.qty ?? 0 }))
        .filter((x) => Number(x.qty) > 0)
        .map((x) => `${x.p.short_name} × ${num(x.qty)}`)
        .join(", ");
  }, [products]);

  if (history.isLoading) return <Empty text="Loading…" />;
  if (history.error) return <Empty text={(history.error as Error).message} />;
  const data = history.data!;
  const orderNo = new Map(data.orders.map((o) => [o.id, o.order_no]));

  if (view === "orders") {
    if (data.orders.length === 0) return <Empty text="No orders yet." />;
    return (
      <div className="divide-y divide-border rounded-xl border border-border">
        {data.orders.map((o) => (
          <div key={o.id} className="space-y-1 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">Order #{o.order_no}</p>
              <Badge variant={o.status === "Delivered" ? "default" : "secondary"}>{o.status}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Ordered {dateLabel(o.order_date)} · Delivery {dateLabel(o.delivery_date)}
            </p>
            <p className="text-sm">{describe(o.order_lines) || "—"}</p>
            <p className="num text-xs text-muted-foreground">Total qty {num(o.total_qty)}</p>
          </div>
        ))}
      </div>
    );
  }

  if (view === "deliveries") {
    const delivered = data.deliveries as Array<
      (typeof data.deliveries)[number] & { delivery_lines?: Line[] }
    >;
    if (delivered.length === 0) return <Empty text="No deliveries yet." />;
    const total = delivered.reduce((s, d) => s + Number(d.total_sales), 0);
    return (
      <div className="space-y-2">
        <p className="num text-sm text-muted-foreground">
          {delivered.length} deliveries · {inr(total)} billed
        </p>
        <div className="divide-y divide-border rounded-xl border border-border">
          {delivered.map((d) => (
            <div key={d.id} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="font-medium">{dateLabel(d.delivery_date)}</p>
                <p className="text-sm break-words">{describe(d.delivery_lines) || "—"}</p>
                {orderNo.has(d.order_id) && (
                  <p className="text-xs text-muted-foreground">Order #{orderNo.get(d.order_id)}</p>
                )}
              </div>
              <p className="num shrink-0 font-semibold">{inr(d.total_sales)}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const payments = data.payments as Array<(typeof data.payments)[number] & { order_id?: string }>;
  const pending = payments.reduce(
    (s, p) => s + Math.max(0, Number(p.amount) - Number(p.amount_received)),
    0,
  );
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-secondary p-4">
        <p className="text-xs text-muted-foreground">Total payment pending</p>
        <p className="num text-2xl font-semibold">{inr(pending)}</p>
      </div>
      {payments.length === 0 ? (
        <Empty text="No payments yet." />
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border">
          {payments.map((p) => {
            const balance = Math.max(0, Number(p.amount) - Number(p.amount_received));
            return (
              <div key={p.id} className="space-y-1 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">
                    {dateLabel(p.payment_date)}
                    {p.order_id && orderNo.has(p.order_id) && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        Order #{orderNo.get(p.order_id)}
                      </span>
                    )}
                  </p>
                  <Badge variant={p.status === "Received" ? "default" : "secondary"}>
                    {p.status}
                  </Badge>
                </div>
                <div className="num grid grid-cols-3 gap-2 text-xs">
                  <span>
                    <span className="block text-muted-foreground">Bill</span>
                    {inr(p.amount)}
                  </span>
                  <span>
                    <span className="block text-muted-foreground">Received</span>
                    {inr(p.amount_received)}
                  </span>
                  <span>
                    <span className="block text-muted-foreground">Pending</span>
                    {inr(balance)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {(collections.data?.length ?? 0) > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Collections
          </p>
          <CollectionList rows={collections.data!} />
        </div>
      )}
    </div>
  );
}

/** Collections as cards: date, amount, change money and who collected. */
export function CollectionList({
  rows,
}: {
  rows: Array<{
    id: string;
    collection_date: string;
    amount: number;
    change_money: number;
    collected_by: string | null;
    change_money_paid: boolean;
  }>;
}) {
  return (
    <div className="divide-y divide-border rounded-xl border border-border">
      {rows.map((c) => (
        <div key={c.id} className="flex items-start justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className="font-medium">{dateLabel(c.collection_date)}</p>
            <p className="text-xs text-muted-foreground">By {c.collected_by ?? "—"}</p>
            {c.change_money > 0 && (
              <p className="num text-xs text-muted-foreground">
                Change money {inr(c.change_money)} · {c.change_money_paid ? "paid" : "not paid yet"}
              </p>
            )}
          </div>
          <p className="num shrink-0 font-semibold">{inr(c.amount)}</p>
        </div>
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{text}</p>;
}
