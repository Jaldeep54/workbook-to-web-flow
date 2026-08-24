import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ShopAreaFilter, shopLabel } from "@/components/filter-bar";
import { ProductQtyGrid } from "@/components/product-qty-grid";
import { SearchableShopSelect } from "@/components/shop-select";
import { ShopSalesIndicator } from "@/components/shop-sales-indicator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ordersApi } from "@/services/klinzo.service";
import { productsQuery, shopAreasQuery, shopProductsQuery, shopsQuery } from "@/lib/queries";
import { ordersOnDateQuery, type OrderRecord } from "@/lib/records";
import { sumQty, type QtyMap } from "@/lib/domain";
import { num, todayISO } from "@/lib/format";

/**
 * The New Order / Edit Order form. Reused by both the main Orders page and
 * Shop Details → Orders (via `lockedShopId`, which preselects and locks the
 * shop so the same form, validation and save logic runs everywhere an order
 * is created — there is exactly one order-creation code path in the app).
 */
export function NewOrderDialog({
  open,
  onOpenChange,
  editing,
  lockedShopId,
  defaultAreaId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: OrderRecord | null;
  /** When set, the shop can't be changed and is preselected to this shop. */
  lockedShopId?: string;
  /** Area the form opens on — the Orders page passes its own area filter through. */
  defaultAreaId?: string | null;
  /** Called after a successful save, in addition to the standard query invalidation. */
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const [shopId, setShopId] = useState("");
  const [areaFilter, setAreaFilter] = useState("all");
  const [orderDate, setOrderDate] = useState(todayISO());
  const [deliveryDate, setDeliveryDate] = useState(todayISO());
  const [qty, setQty] = useState<QtyMap>({});
  const [notes, setNotes] = useState("");

  const { data: products = [] } = useQuery(productsQuery);
  const { data: shops = [] } = useQuery(shopsQuery);
  const { data: areas = [] } = useQuery(shopAreasQuery);
  const { data: shopProducts = [] } = useQuery(shopProductsQuery);

  // (Re)populate the form every time the dialog opens — for a fresh order,
  // an existing one being edited, or a shop locked in from Shop Details.
  useEffect(() => {
    if (!open) return;
    setAreaFilter(defaultAreaId ?? "all");
    if (editing) {
      setShopId(editing.shop_id);
      setOrderDate(editing.order_date ?? todayISO());
      setDeliveryDate(editing.delivery_date ?? editing.order_date ?? todayISO());
      setNotes(editing.notes ?? "");
      const next: QtyMap = {};
      editing.order_lines.forEach((l) => {
        next[l.product_id] = Number(l.qty);
      });
      setQty(next);
    } else {
      setShopId(lockedShopId ?? "");
      setOrderDate(todayISO());
      setDeliveryDate(todayISO());
      setQty({});
      setNotes("");
    }
  }, [open, editing, lockedShopId, defaultAreaId]);

  /**
   * A shop takes at most one order per day, so any shop that already has one
   * on the chosen order date drops out of the picker — and comes back as soon
   * as the date moves. The API enforces the same rule (see the orders
   * controller), this just stops the user reaching a doomed save.
   */
  const { data: ordersOnDate = [] } = useQuery(ordersOnDateQuery(open ? orderDate : null));
  const shopsAlreadyOrdered = useMemo(() => {
    const taken = new Set(ordersOnDate.map((o) => o.shop_id));
    // The order being edited never blocks its own shop.
    if (editing) taken.delete(editing.shop_id);
    return taken;
  }, [ordersOnDate, editing]);

  // If the date moves onto a day the selected shop has already ordered on,
  // clear the selection rather than letting the save fail at the API.
  useEffect(() => {
    if (shopId && !lockedShopId && shopsAlreadyOrdered.has(shopId)) setShopId("");
  }, [shopsAlreadyOrdered, shopId, lockedShopId]);

  const selectedShop = useMemo(() => shops.find((s) => s.id === shopId), [shops, shopId]);
  const selectedShopAreaName = useMemo(() => {
    if (!selectedShop?.area_id) return null;
    return areas.find((a) => a.id === selectedShop.area_id)?.name ?? null;
  }, [selectedShop, areas]);

  // Which products the selected shop works with (existing order lines stay visible even if the
  // shop's product list has since changed, so editing an old order never silently drops data).
  const shopProductIds = useMemo(
    () => new Set(shopProducts.filter((sp) => sp.shop_id === shopId).map((sp) => sp.product_id)),
    [shopProducts, shopId],
  );
  const availableProducts = useMemo(
    () => products.filter((p) => shopProductIds.has(p.id) || (qty[p.id] ?? 0) > 0),
    [products, shopProductIds, qty],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!shopId) throw new Error("Choose a shop");
      if (!orderDate) throw new Error("Order date is required");
      if (!deliveryDate) throw new Error("Delivery date is required");
      if (new Date(deliveryDate) < new Date(orderDate)) {
        throw new Error("Delivery date cannot be before the order date");
      }
      const total = sumQty(qty);
      if (total <= 0) throw new Error("Enter at least one product quantity");
      if (Object.values(qty).some((v) => Number(v) < 0))
        throw new Error("Quantities cannot be negative");

      const payload = {
        shop_id: shopId,
        order_date: orderDate,
        delivery_date: deliveryDate,
        notes: notes || null,
        order_lines: products
          .filter((p) => (qty[p.id] ?? 0) > 0)
          .map((p) => ({ product_id: p.id, qty: qty[p.id] })),
      };

      // One call either way. The API assigns the order number on create and,
      // when the order is already delivered, re-syncs its delivery and payment
      // so the frozen money figures follow the edit.
      if (editing) await ordersApi.update(editing.id, payload);
      else await ordersApi.create(payload);
    },
    onSuccess: () => {
      toast.success(editing ? "Order updated" : "Order recorded");
      onOpenChange(false);
      for (const key of [
        "orders",
        "delivery_sheet",
        "dashboard_summary",
        "label_stock",
        "label_stock_summary",
        "available_months",
        "order_qty_by_product",
        "pending_orders",
        "deliveries",
        "payments",
        "shop_history",
        "shop_analysis",
      ]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
      onSaved?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit order #${editing.order_no}` : "New order"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-3">
            <Label className="text-xs">Shop</Label>
            {lockedShopId ? (
              <p className="rounded-md border border-input bg-muted px-3 py-2 text-sm font-medium">
                {selectedShop ? shopLabel(selectedShop.shop_name, selectedShop.label_name) : "—"}
              </p>
            ) : (
              <div className="flex gap-2">
                <div className="w-40 shrink-0">
                  <ShopAreaFilter
                    value={areaFilter}
                    onChange={(area) => {
                      setAreaFilter(area);
                      setShopId("");
                    }}
                  />
                </div>
                <div className="flex-1">
                  <SearchableShopSelect
                    value={shopId}
                    onChange={setShopId}
                    areaId={areaFilter !== "all" ? areaFilter : null}
                    excludeShopIds={shopsAlreadyOrdered}
                    emptyMessage={`Every shop here already has an order on ${orderDate}.`}
                  />
                </div>
              </div>
            )}
            {shopId && (
              <p className="text-xs text-muted-foreground">
                Area: {selectedShopAreaName ?? "Not Assigned"}
              </p>
            )}
            {/* The picker hides clashing shops, but a locked shop can't be
                swapped — say so here rather than failing at save. */}
            {lockedShopId && shopsAlreadyOrdered.has(lockedShopId) && (
              <p className="text-xs text-destructive">
                This shop already has an order on {orderDate} — edit that order, or choose another
                date.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Order date</Label>
            <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Delivery date</Label>
            <Input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
            />
          </div>
        </div>

        {shopId && <ShopSalesIndicator shopId={shopId} />}

        <div className="mt-2">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Quantities
          </p>
          {!shopId && (
            <p className="text-sm text-muted-foreground">Select a shop to see its products.</p>
          )}
          {shopId && availableProducts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              This shop has no products configured yet — add products to it from the Shops page.
            </p>
          )}
          {shopId && availableProducts.length > 0 && (
            <ProductQtyGrid products={availableProducts} value={qty} onChange={setQty} />
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Notes</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </div>
        <p className="num text-sm text-muted-foreground">Total quantity: {num(sumQty(qty))}</p>
        <DialogFooter>
          <Button
            onClick={() => save.mutate()}
            disabled={!shopId || shopsAlreadyOrdered.has(shopId) || save.isPending}
          >
            {editing ? "Save changes" : "Save order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
