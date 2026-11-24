import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { FieldShopPicker } from "@/components/field-shop-picker";
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
import { paymentCollectorsQuery } from "@/lib/records";
import { dateLabel, inr, todayISO } from "@/lib/format";
import { fieldOpsApi, paymentsApi, type FieldShop } from "@/services/klinzo.service";

type PaymentShop = Pick<FieldShop, "id" | "shop_name" | "label_name" | "code"> & {
  area_id?: string | null;
  pending_balance?: number;
};

export function PaymentMoneyChangeDialog({
  shops,
  month,
  shopId,
  areaId,
  canUpdate,
  canManagePaid,
}: {
  shops: PaymentShop[];
  month: string;
  shopId: string;
  areaId: string;
  canUpdate: boolean;
  canManagePaid: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedShopId, setSelectedShopId] = useState("");
  const [collectionDate, setCollectionDate] = useState(todayISO());
  const [collectorId, setCollectorId] = useState("");
  const [changeMoney, setChangeMoney] = useState("");
  const [allocationsByPayment, setAllocationsByPayment] = useState<Record<string, string>>({});

  const effectiveShopId = selectedShopId || (shopId !== "all" ? shopId : "");
  const pending = useQuery({
    queryKey: ["field_pending", effectiveShopId],
    queryFn: () => fieldOpsApi.pending(effectiveShopId),
    enabled: open && !!effectiveShopId,
  });
  const collectors = useQuery(paymentCollectorsQuery);
  const moneyChanges = useQuery({
    queryKey: ["money_changes", month, shopId, areaId],
    queryFn: () =>
      paymentsApi.moneyChanges({
        month,
        shopId: shopId === "all" ? undefined : shopId,
        areaId: areaId === "all" ? undefined : areaId,
      }),
    enabled: open,
  });

  const allocations = useMemo(
    () =>
      (pending.data?.deliveries ?? []).flatMap((delivery) => {
        const amount = Number(allocationsByPayment[delivery.payment_id]) || 0;
        return amount > 0
          ? [{ payment_id: delivery.payment_id, amount, balance: delivery.balance }]
          : [];
      }),
    [pending.data, allocationsByPayment],
  );
  const collectionTotal = allocations.reduce((total, allocation) => total + allocation.amount, 0);
  const exceedsBalance = allocations.some((allocation) => allocation.amount > allocation.balance);
  const changeAmount = Number(changeMoney) || 0;

  const refreshPayments = () => {
    for (const key of [
      "money_changes",
      "field_pending",
      "field_collections",
      "field_shop_payments",
      "payments",
      "dashboard_summary",
      "cash_position_summary",
      "shop_history",
      "team_activity",
    ]) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const record = useMutation({
    mutationFn: () => {
      if (!effectiveShopId) throw new Error("Choose a shop");
      if (allocations.length === 0) throw new Error("Enter an amount for at least one bill");
      if (exceedsBalance) throw new Error("A bill allocation cannot exceed its pending balance");
      if (!Number.isFinite(changeAmount) || changeAmount <= 0) {
        throw new Error("Money change must be greater than zero");
      }
      return fieldOpsApi.makePayment(effectiveShopId, {
        collection_date: collectionDate,
        allocations: allocations.map(({ payment_id, amount }) => ({ payment_id, amount })),
        change_money: changeAmount,
        collected_by_user_id: collectorId || null,
      });
    },
    onSuccess: () => {
      toast.success("Money change recorded");
      setChangeMoney("");
      setAllocationsByPayment({});
      refreshPayments();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateChange = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: { paid?: boolean; change_money?: number; collection_date?: string };
    }) => paymentsApi.updateMoneyChange(id, patch),
    onSuccess: () => {
      toast.success("Money change updated");
      refreshPayments();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const selectShop = (id: string) => {
    setSelectedShopId(id);
    setAllocationsByPayment({});
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Banknote className="size-4" /> Money Change
      </Button>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setSelectedShopId("");
            setAllocationsByPayment({});
          }
        }}
      >
        <DialogContent className="max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-3xl overflow-y-auto p-4 sm:p-6">
          <DialogHeader className="text-left">
            <DialogTitle>Money Change</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Record change with a collection, then manage payment status and adjustments.
            </p>
          </DialogHeader>

          {canManagePaid && (
            <section className="space-y-4 rounded-xl border border-border p-3 sm:p-4">
              <h3 className="font-medium">Record money change</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Shop</Label>
                  <FieldShopPicker
                    shops={shops}
                    value={effectiveShopId}
                    onChange={selectShop}
                    placeholder="Select shop"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Collection date</Label>
                  <Input
                    type="date"
                    value={collectionDate}
                    onChange={(event) => setCollectionDate(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Collected by</Label>
                  <Select value={collectorId} onValueChange={setCollectorId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select person" />
                    </SelectTrigger>
                    <SelectContent>
                      {(collectors.data ?? []).map((collector) => (
                        <SelectItem key={collector.id} value={collector.id}>
                          {collector.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Money change (₹)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0.01}
                    step="0.01"
                    value={changeMoney}
                    onChange={(event) => setChangeMoney(event.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>

              {effectiveShopId && (
                <div className="rounded-lg border border-border">
                  <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
                    Enter collected amounts against the bills in this collection.
                  </p>
                  {pending.isLoading && (
                    <p className="p-3 text-sm text-muted-foreground">Loading pending bills…</p>
                  )}
                  {pending.isError && (
                    <p className="p-3 text-sm text-destructive">
                      Could not load pending bills: {pending.error.message}
                    </p>
                  )}
                  {!pending.isLoading &&
                    !pending.isError &&
                    (pending.data?.deliveries ?? []).length === 0 && (
                      <p className="p-3 text-sm text-muted-foreground">No pending bills.</p>
                    )}
                  {(pending.data?.deliveries ?? []).map((delivery) => (
                    <div
                      key={delivery.payment_id}
                      className="grid grid-cols-[1fr_8rem] items-center gap-3 border-b border-border px-3 py-2.5 last:border-0"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {dateLabel(delivery.delivery_date)}
                          {delivery.order_no != null && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              Order #{delivery.order_no}
                            </span>
                          )}
                        </p>
                        <p className="num text-xs text-muted-foreground">
                          Balance {inr(delivery.balance, 2)}
                        </p>
                      </div>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={delivery.balance}
                        step="0.01"
                        value={allocationsByPayment[delivery.payment_id] ?? ""}
                        onChange={(event) =>
                          setAllocationsByPayment((current) => ({
                            ...current,
                            [delivery.payment_id]: event.target.value,
                          }))
                        }
                        aria-label={`Amount collected for order ${delivery.order_no ?? ""}`}
                        placeholder="0.00"
                      />
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-border px-3 py-2 text-sm">
                    <span>Collection amount</span>
                    <span className="num font-semibold">{inr(collectionTotal, 2)}</span>
                  </div>
                  {exceedsBalance && (
                    <p className="px-3 pb-3 text-xs text-destructive">
                      A collection amount cannot exceed a bill&apos;s pending balance.
                    </p>
                  )}
                </div>
              )}
              <Button
                className="w-full"
                disabled={
                  record.isPending ||
                  !effectiveShopId ||
                  allocations.length === 0 ||
                  exceedsBalance ||
                  changeAmount <= 0
                }
                onClick={() => record.mutate()}
              >
                Record collection and money change
              </Button>
            </section>
          )}

          <section className="space-y-3">
            <h3 className="font-medium">Recorded money changes</h3>
            {moneyChanges.isLoading && (
              <p className="text-sm text-muted-foreground">Loading money changes…</p>
            )}
            {moneyChanges.isError && (
              <p className="text-sm text-destructive">
                Could not load money changes: {moneyChanges.error.message}
              </p>
            )}
            {!moneyChanges.isLoading &&
              !moneyChanges.isError &&
              (moneyChanges.data ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">No money changes for this month.</p>
              )}
            {(moneyChanges.data ?? []).map((change) => (
              <div
                key={change.id}
                className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_9rem_9rem_auto]"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {change.shop?.shop_name ?? "Unknown shop"}
                    {change.shop?.label_name && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        {change.shop.label_name}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {change.collected_by ?? "Nobody yet"}
                  </p>
                  {change.change_money_paid && (
                    <p className="mt-1 text-xs text-success">
                      Paid{" "}
                      {change.change_money_paid_date
                        ? `on ${dateLabel(change.change_money_paid_date)}`
                        : "in full"}
                    </p>
                  )}
                </div>
                <Input
                  type="date"
                  defaultValue={change.collection_date}
                  key={`${change.id}-${change.collection_date}`}
                  readOnly={!canUpdate}
                  required
                  aria-label={`Collection date for ${change.shop?.shop_name ?? "shop"}`}
                  onBlur={(event) => {
                    if (
                      canUpdate &&
                      event.target.value &&
                      event.target.value !== change.collection_date
                    ) {
                      updateChange.mutate({
                        id: change.id,
                        patch: { collection_date: event.target.value },
                      });
                    }
                  }}
                />
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  defaultValue={change.change_money}
                  key={`${change.id}-${change.change_money}`}
                  readOnly={!canUpdate}
                  aria-label={`Money change amount for ${change.shop?.shop_name ?? "shop"}`}
                  onBlur={(event) => {
                    if (!canUpdate) return;
                    const value = Number(event.target.value);
                    if (Number.isFinite(value) && value >= 0 && value !== change.change_money) {
                      updateChange.mutate({ id: change.id, patch: { change_money: value } });
                    }
                  }}
                />
                {canUpdate && (
                  <Button
                    variant={change.change_money_paid ? "outline" : "default"}
                    disabled={updateChange.isPending}
                    onClick={() =>
                      updateChange.mutate({
                        id: change.id,
                        patch: { paid: !change.change_money_paid },
                      })
                    }
                  >
                    {change.change_money_paid ? (
                      "Mark unpaid"
                    ) : (
                      <>
                        <CheckCircle2 className="size-4" /> Mark paid
                      </>
                    )}
                  </Button>
                )}
              </div>
            ))}
          </section>
        </DialogContent>
      </Dialog>
    </>
  );
}
