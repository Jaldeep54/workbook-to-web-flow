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
import { fieldOpsApi, type FieldShop } from "@/services/klinzo.service";
import { PaymentsPage } from "@/routes/_authenticated/payments";

export const Route = createFileRoute("/_authenticated/field-ops")({
  component: () => (
    <RequirePermission
      anyOf={[
        { resource: RESOURCES.fieldOperations },
        { resource: RESOURCES.fieldOperationsShops },
        { resource: RESOURCES.fieldOperationsDelivery },
        { resource: RESOURCES.fieldOperationsOrders },
        { resource: RESOURCES.fieldOperationsPayments },
      ]}
    >
      <FieldOpsPage />
    </RequirePermission>
  ),
});

type Section = "shops" | "delivery" | "order" | "payments";

const SECTIONS: Array<{ id: Section; label: string; icon: typeof Store; permission: string }> = [
  { id: "shops", label: "Shops", icon: Store, permission: RESOURCES.fieldOperationsShops },
  {
    id: "delivery",
    label: "Delivery",
    icon: CalendarDays,
    permission: RESOURCES.fieldOperationsDelivery,
  },
  {
    id: "order",
    label: "New order",
    icon: ClipboardList,
    permission: RESOURCES.fieldOperationsOrders,
  },
  {
    id: "payments",
    label: "Payments",
    icon: CreditCard,
    permission: RESOURCES.fieldOperationsPayments,
  },
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
  const legacyView = can(RESOURCES.fieldOperations, "view");
  const visibleSections = SECTIONS.filter(
    (section) => legacyView || can(section.permission, "view"),
  );
  const [section, setSection] = useState<Section>(() => {
    try {
      const saved = localStorage.getItem(SECTION_KEY) as Section | null;
      return saved && SECTIONS.some((s) => s.id === saved) ? saved : "shops";
    } catch {
      return "shops";
    }
  });
  const activeSection = visibleSections.some((s) => s.id === section)
    ? section
    : (visibleSections[0]?.id ?? "shops");
  useEffect(() => {
    if (activeSection !== section) setSection(activeSection);
    try {
      localStorage.setItem(SECTION_KEY, activeSection);
    } catch {
      // Private mode — the section just won't be remembered.
    }
  }, [activeSection, section]);

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
        {visibleSections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={cn(
              "flex flex-col items-center gap-0.5 px-1 py-2 text-[11px] font-medium transition-colors sm:flex-row sm:gap-2 sm:rounded-lg sm:px-4 sm:text-sm",
              activeSection === s.id
                ? "text-primary sm:bg-secondary sm:text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <s.icon className="size-5 sm:size-4" />
            {s.label}
          </button>
        ))}
      </nav>

      {activeSection === "shops" && (
        <ShopsSection shops={shops} loading={fieldShops.isLoading} onOpenShop={setInfoShop} />
      )}
      {activeSection === "delivery" &&
        (legacyView ||
        can(RESOURCES.fieldOperationsDelivery, "view") ||
        can(RESOURCES.orders, "view") ? (
          <DeliverySheetPage
            fieldOperationsAccess={can(RESOURCES.fieldOperationsDelivery, "view")}
          />
        ) : (
          <NoAccess what="the delivery sheet" permission="orders:view" />
        ))}
      {activeSection === "order" &&
        (legacyView ||
        can(RESOURCES.fieldOperationsOrders, "view") ||
        can(RESOURCES.orders, "create") ? (
          <NewOrderSection shops={shops} scoped={scope !== "all"} />
        ) : (
          <NoAccess what="new orders" permission="orders:create" />
        ))}
      {activeSection === "payments" && <PaymentsSection shops={shops} />}

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
                  <span
                    className={cn(
                      "block font-medium break-words",
                      s.pending_balance > 0 ? "text-destructive" : "text-success",
                    )}
                  >
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
                        className={cn(
                          "text-left font-medium underline-offset-2 hover:underline",
                          s.pending_balance > 0 ? "text-destructive" : "text-success",
                        )}
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

function PaymentsSection({ shops }: { shops: FieldShop[] }) {
  const [tab, setTab] = useState<"payments" | "collections">("payments");

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl border border-border bg-card p-1">
        <Button
          variant={tab === "payments" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setTab("payments")}
        >
          Payments
        </Button>
        <Button
          variant={tab === "collections" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setTab("collections")}
        >
          Collections
        </Button>
      </div>
      {tab === "payments" ? (
        <PaymentsPage availableShops={shops} />
      ) : (
        <CollectionsSection shops={shops} />
      )}
    </div>
  );
}

function CollectionsSection({ shops }: { shops: FieldShop[] }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { can } = usePermissions();
  const canCollect =
    can(RESOURCES.fieldOperations, "create") || can(RESOURCES.fieldOperationsPayments, "view");
  const canReverse =
    can(RESOURCES.payments, "update") || can(RESOURCES.fieldOperationsPayments, "view");

  const [area, setArea] = useState("all");
  const [shopId, setShopId] = useState("");
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [collectionDate, setCollectionDate] = useState(todayISO());
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, string>>({});
  const [changeMoney, setChangeMoney] = useState("");
  const [collectorId, setCollectorId] = useState(user?.id ?? "");

  const inArea = useMemo(
    () => (area === "all" ? shops : shops.filter((s) => s.area_id === area)),
    [shops, area],
  );
  useEffect(() => {
    if (shopId && !inArea.some((s) => s.id === shopId)) setShopId("");
  }, [inArea, shopId]);
  useEffect(() => setAllocationAmounts({}), [shopId]);

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
  const payments = useQuery({
    queryKey: ["field_shop_payments", shopId],
    queryFn: () => fieldOpsApi.payments(shopId),
    enabled: !!shopId,
  });
  const collectors = useQuery({
    queryKey: ["field_collectors"],
    queryFn: () => fieldOpsApi.collectors(),
    staleTime: 60 * 1000,
    enabled: canCollect,
  });

  const totalPending = pending.data?.total_pending ?? 0;
  const allocations = useMemo(
    () =>
      (pending.data?.deliveries ?? []).flatMap((delivery) => {
        const amount = Number(allocationAmounts[delivery.payment_id]) || 0;
        return amount > 0
          ? [{ payment_id: delivery.payment_id, amount, balance: delivery.balance }]
          : [];
      }),
    [pending.data, allocationAmounts],
  );
  const amountNum = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  const exceedsBillBalance = allocations.some(
    (allocation) => allocation.amount > allocation.balance,
  );

  const invalidate = () => {
    for (const key of [
      "field_pending",
      "field_collections",
      "field_shop_payments",
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
      if (allocations.length === 0) throw new Error("Enter an amount for at least one bill");
      if (exceedsBillBalance)
        throw new Error("A bill allocation cannot exceed its pending balance");
      const change = Number(changeMoney) || 0;
      if (change < 0) throw new Error("Change money cannot be negative");
      return fieldOpsApi.makePayment(shopId, {
        collection_date: collectionDate,
        allocations: allocations.map(({ payment_id, amount }) => ({ payment_id, amount })),
        change_money: change,
        collected_by_user_id: collectorId || null,
      });
    },
    onSuccess: (result) => {
      toast.success(
        `Payment recorded — ${inr(result.total_pending, 2)} still pending for this shop`,
      );
      setAllocationAmounts({});
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
          <FieldShopPicker
            shops={inArea}
            value={shopId}
            onChange={(id) => {
              setAllocationAmounts({});
              setShopId(id);
            }}
          />
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

              <div className="rounded-lg border border-border">
                <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                  Money Added — enter the amount collected for each bill
                </p>
                <div className="divide-y divide-border">
                  {(pending.data?.deliveries ?? []).map((delivery) => (
                    <div
                      key={delivery.payment_id}
                      className="grid grid-cols-[1fr_8rem] items-center gap-3 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {dateLabel(delivery.delivery_date)}
                          {delivery.order_no != null && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              #{delivery.order_no}
                            </span>
                          )}
                        </p>
                        <p className="num text-xs text-muted-foreground">
                          Balance {inr(delivery.balance, 2)}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <Label
                          className="text-[11px] text-muted-foreground"
                          htmlFor={`money-added-${delivery.payment_id}`}
                        >
                          Money Added
                        </Label>
                        <Input
                          id={`money-added-${delivery.payment_id}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={delivery.balance}
                          step="0.01"
                          value={allocationAmounts[delivery.payment_id] ?? ""}
                          onChange={(event) =>
                            setAllocationAmounts((current) => ({
                              ...current,
                              [delivery.payment_id]: event.target.value,
                            }))
                          }
                          aria-label={`Money added to order ${delivery.order_no ?? ""}`}
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between border-t border-border px-3 py-3 text-sm">
                  <span className="font-medium">Collection amount</span>
                  <span className="num font-semibold">{inr(amountNum, 2)}</span>
                </div>
                {exceedsBillBalance && (
                  <p className="px-3 pb-3 text-xs text-destructive">
                    An amount cannot exceed the pending balance on its bill.
                  </p>
                )}
              </div>

              <Button
                size="lg"
                className="w-full"
                disabled={makePayment.isPending || allocations.length === 0 || exceedsBillBalance}
                onClick={() => makePayment.mutate()}
              >
                Make Payment
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Bills and payment details
            </p>
            <div className="surface-card overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Shop</TableHead>
                      <TableHead className="text-right">Order</TableHead>
                      <TableHead className="whitespace-nowrap text-right">Bill amount</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Collected by</TableHead>
                      <TableHead className="whitespace-nowrap">Date of collection</TableHead>
                      <TableHead className="whitespace-nowrap">Expected collection date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.isLoading && (
                      <TableRow>
                        <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                          Loading payments…
                        </TableCell>
                      </TableRow>
                    )}
                    {payments.isError && (
                      <TableRow>
                        <TableCell colSpan={10} className="py-8 text-center text-destructive">
                          Could not load bills: {payments.error.message}
                        </TableCell>
                      </TableRow>
                    )}
                    {!payments.isLoading &&
                      !payments.isError &&
                      (payments.data ?? []).length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={10}
                            className="py-8 text-center text-muted-foreground"
                          >
                            No bills for this shop yet.
                          </TableCell>
                        </TableRow>
                      )}
                    {(payments.data ?? []).map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="whitespace-nowrap">
                          {dateLabel(payment.payment_date)}
                        </TableCell>
                        <TableCell className="font-medium">
                          {selectedShop?.shop_name ?? "—"}
                          {selectedShop?.label_name && (
                            <p className="text-xs text-muted-foreground">
                              {selectedShop.label_name}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="num text-right">{payment.order_no ?? "—"}</TableCell>
                        <TableCell className="num text-right font-semibold">
                          {inr(payment.amount)}
                        </TableCell>
                        <TableCell className="num text-right">
                          {inr(payment.amount_received)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "num text-right font-semibold",
                            payment.balance > 0 ? "text-destructive" : "text-success",
                          )}
                        >
                          {payment.balance > 0 ? inr(payment.balance) : "—"}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium",
                              payment.status === "Received"
                                ? "bg-success/10 text-success"
                                : payment.status === "Partial"
                                  ? "bg-warning/10 text-warning"
                                  : "bg-muted text-muted-foreground",
                            )}
                          >
                            {payment.status === "Received"
                              ? "Paid in full"
                              : payment.status === "Partial"
                                ? "Part paid"
                                : "Not paid"}
                          </span>
                        </TableCell>
                        <TableCell>{payment.collected_by ?? "Nobody yet"}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {dateLabel(payment.collected_date)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {dateLabel(payment.expected_collection_date)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>

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
                  {selectedShop?.shop_name} · oldest first for reference; collection amounts are
                  entered per bill
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
