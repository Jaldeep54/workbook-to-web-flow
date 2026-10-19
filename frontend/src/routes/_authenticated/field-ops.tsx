import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronRight,
  ClipboardList,
  CreditCard,
  MapPin,
  Plus,
  Store,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { DeliverySheetPage } from "@/components/delivery-sheet-page";
import { FieldShopPicker } from "@/components/field-shop-picker";
import { ShopAreaFilter, shopLabel } from "@/components/filter-bar";
import { NewOrderDialog } from "@/components/new-order-dialog";
import { RequirePermission } from "@/components/require-permission";
import { SearchInput } from "@/components/search-input";
import { CollectionList, ShopInfoDialog } from "@/components/shop-info";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { RESOURCES, usePermissions } from "@/hooks/usePermissions";
import { fieldShopsQuery } from "@/lib/queries";
import { dateLabel, inr, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fieldOpsApi, type FieldShop, type PendingDelivery } from "@/services/klinzo.service";

export const Route = createFileRoute("/_authenticated/field-ops")({
  component: () => (
    <RequirePermission resource={RESOURCES.fieldOperations}>
      <FieldOpsPage />
    </RequirePermission>
  ),
});

type Section = "shops" | "delivery" | "order" | "payments";

const SECTIONS: Array<{ id: Section; label: string; icon: typeof Store }> = [
  { id: "shops", label: "Shops", icon: Store },
  { id: "delivery", label: "Delivery", icon: CalendarDays },
  { id: "order", label: "New order", icon: ClipboardList },
  { id: "payments", label: "Payments", icon: CreditCard },
];

const SECTION_KEY = "field_ops_section";

/**
 * Field Operations — the tab managers and salespersons work from, almost
 * always on a phone. Four sections behind a thumb-reachable switcher: their
 * shops, the delivery sheet, new orders and payment collection.
 *
 * A manager or salesperson only ever sees the shops assigned to them (the API
 * scopes every call); office staff with no field role see every shop.
 */
function FieldOpsPage() {
  const { can } = usePermissions();
  const [section, setSection] = useState<Section>(() => {
    try {
      const saved = localStorage.getItem(SECTION_KEY) as Section | null;
      return saved && SECTIONS.some((s) => s.id === saved) ? saved : "shops";
    } catch {
      return "shops";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SECTION_KEY, section);
    } catch {
      // Private mode — the section just won't be remembered.
    }
  }, [section]);

  const [infoShop, setInfoShop] = useState<FieldShop | null>(null);
  const fieldShops = useQuery(fieldShopsQuery);
  const shops = fieldShops.data?.shops ?? [];
  const scope = fieldShops.data?.scope ?? "all";

  return (
    <div className="pb-20 sm:pb-0">
      <PageHeader
        title="Field Operations"
        description={
          scope === "all"
            ? "All shops — your role has no field team, so nothing is filtered"
            : `Shops assigned to you as ${scope === "manager" ? "manager" : "salesperson"}`
        }
      />

      {/* Phone: fixed to the bottom, where a thumb reaches. Wider screens: a
          segmented control under the header. */}
      <nav
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-background/95 backdrop-blur",
          "sm:static sm:mb-6 sm:inline-grid sm:rounded-xl sm:border sm:bg-card sm:p-1",
        )}
      >
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={cn(
              "flex flex-col items-center gap-0.5 px-1 py-2 text-[11px] font-medium transition-colors sm:flex-row sm:gap-2 sm:rounded-lg sm:px-4 sm:text-sm",
              section === s.id
                ? "text-primary sm:bg-secondary sm:text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <s.icon className="size-5 sm:size-4" />
            {s.label}
          </button>
        ))}
      </nav>

      {section === "shops" && (
        <ShopsSection shops={shops} loading={fieldShops.isLoading} onOpenShop={setInfoShop} />
      )}
      {section === "delivery" &&
        (can(RESOURCES.orders, "view") ? (
          <DeliverySheetPage />
        ) : (
          <NoAccess what="the delivery sheet" permission="orders:view" />
        ))}
      {section === "order" &&
        (can(RESOURCES.orders, "create") ? (
          <NewOrderSection shops={shops} scoped={scope !== "all"} />
        ) : (
          <NoAccess what="new orders" permission="orders:create" />
        ))}
      {section === "payments" && <PaymentsSection shops={shops} />}

      <ShopInfoDialog
        shopId={infoShop?.id ?? null}
        shopName={infoShop ? shopLabel(infoShop.shop_name, infoShop.label_name) : null}
        open={!!infoShop}
        onOpenChange={(open) => !open && setInfoShop(null)}
      />
    </div>
  );
}

function NoAccess({ what, permission }: { what: string; permission: string }) {
  return (
    <div className="surface-card p-6 text-center text-sm text-muted-foreground">
      Your role can&apos;t open {what}. Ask an administrator for{" "}
      <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">{permission}</code>.
    </div>
  );
}

function mapsLink(shop: FieldShop): string | null {
  if (shop.latitude != null && shop.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${shop.latitude},${shop.longitude}`;
  }
  if (shop.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shop.address)}`;
  }
  return null;
}

/* ------------------------------------------------------------- shops list */

function ShopsSection({
  shops,
  loading,
  onOpenShop,
}: {
  shops: FieldShop[];
  loading: boolean;
  onOpenShop: (shop: FieldShop) => void;
}) {
  const [area, setArea] = useState("all");
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shops.filter(
      (s) =>
        (area === "all" || s.area_id === area) &&
        (!q ||
          s.shop_name.toLowerCase().includes(q) ||
          (s.label_name ?? "").toLowerCase().includes(q) ||
          s.code.toLowerCase().includes(q)),
    );
  }, [shops, area, search]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
        <ShopAreaFilter value={area} onChange={setArea} />
        <SearchInput value={search} onChange={setSearch} placeholder="Search shops…" />
      </div>
      <p className="text-xs text-muted-foreground">
        {visible.length} shop{visible.length === 1 ? "" : "s"} · tap a shop for orders, deliveries,
        payments and analysis
      </p>

      {loading && <p className="py-8 text-center text-sm text-muted-foreground">Loading shops…</p>}
      {!loading && visible.length === 0 && (
        <div className="surface-card p-6 text-center text-sm text-muted-foreground">
          {shops.length === 0
            ? "No shops are assigned to you yet. Ask your manager to give you access."
            : "No shops match."}
        </div>
      )}

      {/* Phone: one card per shop. */}
      <div className="space-y-2 md:hidden">
        {visible.map((s, i) => {
          const link = mapsLink(s);
          return (
            <div key={s.id} className="surface-card overflow-hidden">
              <button
                type="button"
                onClick={() => onOpenShop(s)}
                className="flex w-full items-center gap-3 p-4 text-left active:bg-secondary"
              >
                <span className="num w-6 shrink-0 text-xs text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium break-words">
                    {shopLabel(s.shop_name, s.label_name)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {s.area_name ?? "No area"}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border px-4 py-3 text-xs">
                <div>
                  <dt className="text-muted-foreground">Manager</dt>
                  <dd className="font-medium">{s.handled_by ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Salesperson</dt>
                  <dd className="font-medium">{s.salesperson ?? "—"}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Location</dt>
                  <dd>
                    {link ? (
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-start gap-1 text-primary underline-offset-2 hover:underline"
                      >
                        <MapPin className="mt-0.5 size-3 shrink-0" />
                        <span className="break-words">{s.address || "Open in Maps"}</span>
                      </a>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>

      {/* Tablet and up: the same list as a table. */}
      {visible.length > 0 && (
        <div className="surface-card hidden overflow-x-auto md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">S.No</TableHead>
                <TableHead>Shop Name</TableHead>
                <TableHead>Shop Area</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Manager Name</TableHead>
                <TableHead>Salesperson Name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((s, i) => {
                const link = mapsLink(s);
                return (
                  <TableRow key={s.id}>
                    <TableCell className="num">{i + 1}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => onOpenShop(s)}
                        className="text-left font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {shopLabel(s.shop_name, s.label_name)}
                      </button>
                    </TableCell>
                    <TableCell>{s.area_name ?? "—"}</TableCell>
                    <TableCell className="max-w-[16rem]">
                      {link ? (
                        <a
                          href={link}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-start gap-1 text-primary underline-offset-2 hover:underline"
                        >
                          <MapPin className="mt-0.5 size-3 shrink-0" />
                          <span className="line-clamp-2">{s.address || "Open in Maps"}</span>
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>{s.handled_by ?? "—"}</TableCell>
                    <TableCell>{s.salesperson ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- new order */

function NewOrderSection({ shops, scoped }: { shops: FieldShop[]; scoped: boolean }) {
  const [open, setOpen] = useState(false);
  const allowed = useMemo(() => new Set(shops.map((s) => s.id)), [shops]);

  return (
    <div className="surface-card space-y-4 p-5 text-center">
      <ClipboardList className="mx-auto size-10 text-muted-foreground/60" />
      <div>
        <p className="font-medium">Take a new order</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick the shop, enter quantities and save. Use{" "}
          <span className="font-medium">Shop Info</span> on the form to check the shop&apos;s
          orders, deliveries, payments and analysis first.
        </p>
      </div>
      <Button size="lg" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> New order
      </Button>
      <NewOrderDialog
        open={open}
        onOpenChange={setOpen}
        editing={null}
        allowedShopIds={scoped ? allowed : undefined}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- payments */

/** What Make Payment will do with `amount`, delivery by delivery — mirrors the API. */
function previewAllocation(pending: PendingDelivery[], amount: number) {
  let remaining = amount;
  return pending.map((p) => {
    const paid = Math.max(0, Math.min(p.balance, remaining));
    remaining -= paid;
    return {
      ...p,
      paying: Math.round(paid * 100) / 100,
      left: Math.round((p.balance - paid) * 100) / 100,
    };
  });
}

function PaymentsSection({ shops }: { shops: FieldShop[] }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { can } = usePermissions();
  const canCollect = can(RESOURCES.fieldOperations, "create");
  const canReverse = can(RESOURCES.payments, "update");

  const [area, setArea] = useState("all");
  const [shopId, setShopId] = useState("");
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [collectionDate, setCollectionDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [changeMoney, setChangeMoney] = useState("");
  const [collectorId, setCollectorId] = useState(user?.id ?? "");

  const inArea = useMemo(
    () => (area === "all" ? shops : shops.filter((s) => s.area_id === area)),
    [shops, area],
  );
  useEffect(() => {
    if (shopId && !inArea.some((s) => s.id === shopId)) setShopId("");
  }, [inArea, shopId]);

  const pending = useQuery({
    queryKey: ["field_pending", shopId],
    queryFn: () => fieldOpsApi.pending(shopId),
    enabled: !!shopId,
  });
  const collections = useQuery({
    queryKey: ["field_collections", shopId],
    queryFn: () => fieldOpsApi.collections(shopId),
    enabled: !!shopId,
  });
  const collectors = useQuery({
    queryKey: ["field_collectors"],
    queryFn: () => fieldOpsApi.collectors(),
    staleTime: 60 * 1000,
    enabled: canCollect,
  });

  const totalPending = pending.data?.total_pending ?? 0;
  const amountNum = Number(amount) || 0;
  const preview = useMemo(
    () => previewAllocation(pending.data?.deliveries ?? [], amountNum),
    [pending.data, amountNum],
  );

  const invalidate = () => {
    for (const key of [
      "field_pending",
      "field_collections",
      "payments",
      "shop_history",
      "dashboard_summary",
      "cash_position_summary",
      "team_activity",
    ]) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const makePayment = useMutation({
    mutationFn: () => {
      if (!shopId) throw new Error("Choose a shop");
      if (amountNum <= 0) throw new Error("Enter the collection amount");
      if (amountNum > totalPending) {
        throw new Error(`The shop only owes ${inr(totalPending, 2)}`);
      }
      const change = Number(changeMoney) || 0;
      if (change < 0) throw new Error("Change money cannot be negative");
      return fieldOpsApi.makePayment(shopId, {
        collection_date: collectionDate,
        amount: amountNum,
        change_money: change,
        collected_by_user_id: collectorId || null,
      });
    },
    onSuccess: (result) => {
      toast.success(
        `Payment recorded — ${inr(result.total_pending, 2)} still pending for this shop`,
      );
      setAmount("");
      setChangeMoney("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reverse = useMutation({
    mutationFn: (id: string) => fieldOpsApi.reverseCollection(id),
    onSuccess: () => {
      toast.success("Collection reversed");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectedShop = shops.find((s) => s.id === shopId);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Shop Area</Label>
          <ShopAreaFilter value={area} onChange={setArea} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Shop Name</Label>
          <FieldShopPicker shops={inArea} value={shopId} onChange={setShopId} />
        </div>
      </div>

      {!shopId && (
        <div className="surface-card p-6 text-center text-sm text-muted-foreground">
          Choose a shop area and shop to see what it owes and record a collection.
        </div>
      )}

      {shopId && (
        <>
          <button
            type="button"
            onClick={() => setBreakdownOpen(true)}
            className="surface-card flex w-full items-center justify-between gap-3 p-5 text-left active:bg-secondary"
          >
            <span>
              <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Total payment pending
              </span>
              <span
                className={cn(
                  "num mt-1 block font-display text-3xl font-semibold",
                  totalPending > 0 ? "text-destructive" : "text-success",
                )}
              >
                {pending.isLoading ? "…" : inr(totalPending, 2)}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {pending.data?.deliveries.length ?? 0} deliveries pending · tap for breakdown
              </span>
            </span>
            <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
          </button>

          {canCollect && totalPending > 0 && (
            <div className="surface-card space-y-4 p-4 sm:p-5">
              <p className="font-medium">Record collection</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5 sm:col-span-1">
                  <Label className="text-xs">Collection Date</Label>
                  <Input
                    type="date"
                    value={collectionDate}
                    onChange={(e) => setCollectionDate(e.target.value)}
                  />
                </div>
                <div className="col-span-2 space-y-1.5 sm:col-span-1">
                  <Label className="text-xs">Collected By</Label>
                  <Select value={collectorId} onValueChange={setCollectorId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select person" />
                    </SelectTrigger>
                    <SelectContent>
                      {(collectors.data ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.full_name}
                          {c.id === user?.id ? " (you)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Collection Amount (₹)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Change Money (₹)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={changeMoney}
                    onChange={(e) => setChangeMoney(e.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Change money comes out of cash in hand once a manager marks it paid on the Manager
                Dashboard.
              </p>

              {amountNum > 0 && (
                <div className="rounded-lg border border-border">
                  <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                    Will be applied oldest delivery first
                  </p>
                  <div className="divide-y divide-border">
                    {preview
                      .filter((p) => p.paying > 0)
                      .map((p) => (
                        <div
                          key={p.payment_id}
                          className="num flex justify-between gap-2 px-3 py-2 text-sm"
                        >
                          <span>
                            {dateLabel(p.delivery_date)}
                            {p.order_no != null && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                #{p.order_no}
                              </span>
                            )}
                          </span>
                          <span>
                            {inr(p.paying, 2)}
                            <span className="ml-1 text-xs text-muted-foreground">
                              {p.left > 0 ? `· ${inr(p.left, 2)} left` : "· paid"}
                            </span>
                          </span>
                        </div>
                      ))}
                  </div>
                  {amountNum > totalPending && (
                    <p className="px-3 py-2 text-xs text-destructive">
                      More than the {inr(totalPending, 2)} this shop owes.
                    </p>
                  )}
                </div>
              )}

              <Button
                size="lg"
                className="w-full"
                disabled={makePayment.isPending || amountNum <= 0 || amountNum > totalPending}
                onClick={() => makePayment.mutate()}
              >
                Make Payment
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Collections from {selectedShop?.shop_name ?? "this shop"}
            </p>
            {collections.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {collections.data && collections.data.length === 0 && (
              <p className="text-sm text-muted-foreground">No collections recorded yet.</p>
            )}
            {collections.data && collections.data.length > 0 && (
              <>
                <CollectionList rows={collections.data} />
                {canReverse && (
                  <div className="flex flex-wrap gap-2">
                    {collections.data.slice(0, 1).map((c) => (
                      <Button
                        key={c.id}
                        variant="outline"
                        size="sm"
                        disabled={reverse.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Reverse the ${inr(c.amount, 2)} collection of ${dateLabel(c.collection_date)}? The amounts go back to pending.`,
                            )
                          ) {
                            reverse.mutate(c.id);
                          }
                        }}
                      >
                        <Undo2 className="size-4" /> Reverse latest collection
                      </Button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <Dialog open={breakdownOpen} onOpenChange={setBreakdownOpen}>
            <DialogContent className="max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto p-4 sm:p-6">
              <DialogHeader className="text-left">
                <DialogTitle>Pending by delivery</DialogTitle>
                <p className="text-xs text-muted-foreground">
                  {selectedShop?.shop_name} · oldest first, the order payments are applied in
                </p>
              </DialogHeader>
              {(pending.data?.deliveries ?? []).length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Nothing pending.</p>
              ) : (
                <div className="divide-y divide-border rounded-xl border border-border">
                  {pending.data!.deliveries.map((d) => (
                    <div key={d.payment_id} className="space-y-1 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">
                          {dateLabel(d.delivery_date)}
                          {d.order_no != null && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              Order #{d.order_no}
                            </span>
                          )}
                        </p>
                        <p className="num font-semibold text-destructive">{inr(d.balance, 2)}</p>
                      </div>
                      <p className="num text-xs text-muted-foreground">
                        Bill {inr(d.amount, 2)} · received {inr(d.amount_received, 2)}
                      </p>
                    </div>
                  ))}
                  <div className="num flex justify-between p-3 font-semibold">
                    <span>Total</span>
                    <span>{inr(totalPending, 2)}</span>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
