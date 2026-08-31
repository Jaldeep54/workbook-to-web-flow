import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  MapPin,
  Plus,
  MapPinned,
  Search,
  Store,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { DataPagination, usePagination } from "@/components/data-pagination";
import { LocationPicker } from "@/components/location-picker";
import { ProductMultiSelect, ProductChips } from "@/components/product-multi-select";
import { RecordCard, RecordCards, RecordField } from "@/components/record-card";
import { ShopAreaFilter } from "@/components/filter-bar";
import { ShopAreaSelect } from "@/components/shop-area-select";
import { ShopAreasDialog } from "@/components/shop-areas-dialog";
import { ShopImageField } from "@/components/shop-image-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { shopsApi } from "@/services/klinzo.service";
import { fileUrl } from "@/services/api-client";
import {
  fetchNextShopCode,
  productsQuery,
  shopAreasQuery,
  shopHandlersQuery,
  shopProductsQuery,
  shopsQuery,
} from "@/lib/queries";
import { isHeicPath } from "@/lib/shop-image";
import { downloadCsv } from "@/lib/export";
import { dateLabel } from "@/lib/format";
import { designTypeColor, googleMapsDirectionsUrl } from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { Shop } from "@/lib/domain";
import type { ShopHandler } from "@/services/klinzo.service";

export const Route = createFileRoute("/_authenticated/shops/")({
  component: () => (
    <RequirePermission resource={RESOURCES.shops}>
      <ShopsPage />
    </RequirePermission>
  ),
});

/** Sentinel values for the two non-user options in the "Handled by" picker. */
const NO_HANDLER = "__none__";
const LEGACY_HANDLER = "__legacy__";

/** Sentinel for "shops with nobody assigned" in the Handled by column filter. */
const UNASSIGNED = "__unassigned__";

/** The shop columns that can be sorted on — `design_type` is the only numeric one. */
type SortKey = "shop_name" | "handled_by" | "joined_on" | "mobile" | "design_type";
type SortState = { key: SortKey; dir: "asc" | "desc" };

const emptyShop = {
  code: "",
  folder_name: "",
  shop_name: "",
  label_name: "",
  bill_name: "",
  design_type: 1,
  area_id: null as string | null,
  address: "",
  latitude: null as number | null,
  longitude: null as number | null,
  mobile: "",
  handled_by: "",
  handled_by_user_id: null as string | null,
  joined_on: "",
  is_active: true,
};

/**
 * "Handled by" is a user account, not free text: the options are the active
 * users of every role flagged "members handle shops" (Admin → Roles &
 * permissions). Retiring a salesman is therefore just deactivating their
 * account — they leave this list immediately, while the shops they used to
 * handle keep showing their name.
 *
 * Two kinds of shop have a handler who isn't in that list: ones imported from
 * the workbook (a name, no account) and ones whose handler has since been
 * deactivated. Both keep their stored name as a selectable option, so opening
 * such a shop for an unrelated edit never silently blanks the field.
 */
function HandledBySelect({
  userId,
  name,
  onChange,
  handlers,
  isLoading,
}: {
  userId: string | null;
  name: string;
  onChange: (next: { handled_by_user_id: string | null; handled_by: string }) => void;
  handlers: ShopHandler[];
  isLoading: boolean;
}) {
  const isCurrent = !!userId && handlers.some((h) => h.id === userId);
  // A stored name with no assignable account behind it — legacy or retired.
  const retiredName = !isLoading && !isCurrent && name ? name : null;
  const value = isCurrent ? userId! : retiredName ? LEGACY_HANDLER : "";

  if (!isLoading && handlers.length === 0 && !retiredName) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        No one can be assigned yet. In Admin → Roles &amp; permissions, switch on “Members handle
        shops” for a role (the seeded <span className="font-medium">Salesman</span> role has it
        already), then add users to it.
      </p>
    );
  }

  return (
    <Select
      value={value || undefined}
      onValueChange={(v) => {
        if (v === LEGACY_HANDLER) return;
        if (v === NO_HANDLER) {
          onChange({ handled_by_user_id: null, handled_by: "" });
          return;
        }
        const picked = handlers.find((h) => h.id === v);
        onChange({ handled_by_user_id: v, handled_by: picked?.full_name ?? "" });
      }}
    >
      <SelectTrigger>
        <SelectValue placeholder={isLoading ? "Loading people…" : "Select person"} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_HANDLER}>Not assigned</SelectItem>
        {retiredName && (
          <SelectItem value={LEGACY_HANDLER}>{retiredName} — no active account</SelectItem>
        )}
        {handlers.map((h) => (
          <SelectItem key={h.id} value={h.id}>
            {h.full_name}
            <span className="ml-2 text-xs text-muted-foreground">{h.role_name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ShopsPage() {
  const qc = useQueryClient();
  const { data: shops = [], isLoading } = useQuery(shopsQuery);
  const { data: products = [] } = useQuery(productsQuery);
  const { data: shopProducts = [] } = useQuery(shopProductsQuery);
  const { data: areas = [] } = useQuery(shopAreasQuery);
  const { data: handlers = [], isLoading: handlersLoading } = useQuery(shopHandlersQuery);
  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState("all");
  const [handlerFilter, setHandlerFilter] = useState("all");
  const [designFilter, setDesignFilter] = useState("all");
  const [sort, setSort] = useState<SortState>({ key: "shop_name", dir: "asc" });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Shop | null>(null);
  const [form, setForm] = useState({ ...emptyShop });
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [detailsShop, setDetailsShop] = useState<Shop | null>(null);
  const [deletingShop, setDeletingShop] = useState<Shop | null>(null);
  // Deleting a shop is confirmed twice: the first dialog explains what
  // "delete" actually does, the second asks outright.
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [areasOpen, setAreasOpen] = useState(false);

  const areaName = useMemo(() => {
    const map = new Map(areas.map((a) => [a.id, a.name]));
    return (areaId: string | null) =>
      areaId ? (map.get(areaId) ?? "Not Assigned") : "Not Assigned";
  }, [areas]);

  const productsByShop = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const link of shopProducts) {
      map.set(link.shop_id, [...(map.get(link.shop_id) ?? []), link.product_id]);
    }
    return map;
  }, [shopProducts]);

  const designTypes = useMemo(
    () => Array.from(new Set(shops.map((s) => s.design_type))).sort((a, b) => a - b),
    [shops],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shops
      .filter((s) => areaFilter === "all" || s.area_id === areaFilter)
      .filter((s) =>
        handlerFilter === "all"
          ? true
          : handlerFilter === UNASSIGNED
            ? !s.handled_by_user_id
            : s.handled_by_user_id === handlerFilter,
      )
      .filter((s) => designFilter === "all" || String(s.design_type) === designFilter)
      .filter(
        (s) =>
          !q ||
          [
            s.code,
            s.shop_name,
            s.label_name,
            s.handled_by,
            s.mobile,
            s.address,
            areaName(s.area_id),
          ]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
      );
  }, [shops, search, areaFilter, handlerFilter, designFilter, areaName]);

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const key = sort.key;
    return [...filtered].sort((a, b) => {
      if (key === "design_type") return (a.design_type - b.design_type) * dir;
      const av = a[key] ?? "";
      const bv = b[key] ?? "";
      // Blanks sit at the bottom whichever way the column is sorted — a shop
      // with no mobile number is never the "first" result.
      if (!av !== !bv) return av ? -1 : 1;
      return av.localeCompare(bv, "en-IN", { numeric: true, sensitivity: "base" }) * dir;
    });
  }, [filtered, sort]);

  const pagination = usePagination(sorted, {
    resetKey: `${search}-${areaFilter}-${handlerFilter}-${designFilter}`,
  });

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );

  /**
   * A shop is only saved once it is described in full: every field on the form
   * is mandatory, so no shop reaches the table with a blank column. The photo
   * is the sole exception — it is uploaded separately and is often taken
   * later, so requiring it would block adding a shop at all.
   *
   * The same rule applies when editing, which is how shops imported from the
   * workbook get their gaps filled in.
   */
  const missingRequired = useMemo(() => {
    const missing: string[] = [];
    if (!form.area_id) missing.push("Shop area");
    if (!form.folder_name.trim()) missing.push("Folder name");
    if (!form.shop_name.trim()) missing.push("Shop name");
    if (!form.label_name.trim()) missing.push("Label name");
    if (!form.bill_name.trim()) missing.push("Bill name");
    if (!(Number(form.design_type) > 0)) missing.push("Design type");
    if (!form.mobile.trim()) missing.push("Mobile");
    if (!form.handled_by.trim()) missing.push("Handled by");
    if (!form.joined_on) missing.push("Joined on");
    if (selectedProducts.length === 0) missing.push("Products this shop works with");
    if (!form.address.trim()) missing.push("Address");
    if (form.latitude == null || form.longitude == null) missing.push("Location");
    return missing;
  }, [form, selectedProducts]);

  const save = useMutation({
    mutationFn: async () => {
      if (missingRequired.length > 0) throw new Error(`Required: ${missingRequired.join(", ")}`);

      const payload = {
        ...form,
        code: form.code.trim(),
        shop_name: form.shop_name.trim(),
        joined_on: form.joined_on || null,
        handled_by: form.handled_by.trim() || null,
        design_type: Number(form.design_type) || 1,
        // The shop's product list is saved with the shop in one call; the API
        // works out what to add and remove.
        product_ids: selectedProducts,
      };

      const shop = editing
        ? await shopsApi.update(editing.id, payload)
        : await shopsApi.create(payload);

      // The photo is a separate upload (multipart), applied after the shop
      // itself exists so a new shop always has an id to attach it to.
      if (imageFile) {
        await shopsApi.uploadImage(shop.id, imageFile);
      } else if (removeImage && editing?.image_path) {
        await shopsApi.removeImage(shop.id);
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Shop updated" : "Shop added");
      closeForm();
      void qc.invalidateQueries({ queryKey: ["shops"] });
      void qc.invalidateQueries({ queryKey: ["shop_products"] });
      void qc.invalidateQueries({ queryKey: ["sku_opportunity"] });
      void qc.invalidateQueries({ queryKey: ["label_stock"] });
      void qc.invalidateQueries({ queryKey: ["label_stock_summary"] });
      void qc.invalidateQueries({ queryKey: ["shop_image_url"] });
      void qc.invalidateQueries({ queryKey: ["shop_analysis"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archive = useMutation({
    // "Delete" deactivates: a shop's orders, deliveries and payments are
    // history and are never removed with it.
    mutationFn: (shop: Shop) => shopsApi.deactivate(shop.id),
    onSuccess: () => {
      toast.success("Shop deleted");
      closeDelete();
      setDetailsShop(null);
      void qc.invalidateQueries({ queryKey: ["shops"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const closeDelete = () => {
    setDeletingShop(null);
    setDeleteConfirmed(false);
  };

  const closeForm = () => {
    setOpen(false);
    setEditing(null);
    setForm({ ...emptyShop });
    setSelectedProducts([]);
    setImageFile(null);
    setRemoveImage(false);
  };

  /**
   * New shops get the next sequential code automatically — no longer shown in
   * the UI — and start in whichever area the table is currently filtered to,
   * since shops are normally added a neighbourhood at a time.
   */
  const openCreate = async () => {
    setEditing(null);
    setSelectedProducts([]);
    setForm({ ...emptyShop, area_id: areaFilter === "all" ? null : areaFilter });
    setImageFile(null);
    setRemoveImage(false);
    setOpen(true);
    try {
      const code = await fetchNextShopCode();
      setForm((f) => ({ ...f, code }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate a shop code");
    }
  };

  const openEdit = (shop: Shop) => {
    setDetailsShop(null);
    setEditing(shop);
    setSelectedProducts(productsByShop.get(shop.id) ?? []);
    setImageFile(null);
    setRemoveImage(false);
    setForm({
      code: shop.code,
      folder_name: shop.folder_name ?? "",
      shop_name: shop.shop_name,
      label_name: shop.label_name ?? "",
      bill_name: shop.bill_name ?? "",
      design_type: shop.design_type,
      area_id: shop.area_id,
      address: shop.address ?? "",
      latitude: shop.latitude,
      longitude: shop.longitude,
      mobile: shop.mobile ?? "",
      handled_by: shop.handled_by ?? "",
      handled_by_user_id: shop.handled_by_user_id ?? null,
      joined_on: shop.joined_on ?? "",
      is_active: shop.is_active,
    });
    setOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Shops"
        description={`${shops.length} shops — the workbook's 100+ shop sheets in one searchable table`}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(
                  "klinzo-shops",
                  sorted.map((s) => ({
                    Code: s.code,
                    Shop: s.shop_name,
                    "Label name": s.label_name ?? "",
                    "Bill name": s.bill_name ?? "",
                    Area: areaName(s.area_id),
                    Design: s.design_type,
                    Mobile: s.mobile ?? "",
                    Address: s.address ?? "",
                    "Handled by": s.handled_by ?? "",
                    "Joined on": s.joined_on ?? "",
                    Active: s.is_active ? "Yes" : "No",
                  })),
                )
              }
            >
              <Download className="size-4" /> Export
            </Button>
            <Can resource={RESOURCES.shopAreas} action="view">
              <Button variant="outline" onClick={() => setAreasOpen(true)}>
                <MapPinned className="size-4" /> Shop areas
              </Button>
            </Can>
            <Can resource={RESOURCES.shops} action="create">
              <Button onClick={() => void openCreate()}>
                <Plus className="size-4" /> New shop
              </Button>
            </Can>
          </>
        }
      />

      <ShopAreasDialog open={areasOpen} onOpenChange={setAreasOpen} />

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : closeForm())}>
        <DialogContent className="flex max-h-[85vh] max-w-lg flex-col overflow-hidden p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>{editing ? "Edit shop" : "New shop"}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 space-y-5 overflow-y-auto px-6 pb-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label className="mb-1.5 block text-xs">
                  Shop area <RequiredMark />
                </Label>
                <ShopAreaSelect
                  value={form.area_id}
                  onChange={(areaId) => setForm({ ...form, area_id: areaId })}
                />
              </div>
              <div className="sm:col-span-2">
                <ShopImageField
                  existingPath={editing?.image_path ?? null}
                  existingUrl={editing?.image_url ?? null}
                  file={imageFile}
                  removed={removeImage}
                  onFileChange={(f) => {
                    setImageFile(f);
                    setRemoveImage(false);
                  }}
                  onRemove={() => {
                    setImageFile(null);
                    setRemoveImage(true);
                  }}
                />
              </div>
              <Field
                label="Folder name"
                required
                value={form.folder_name}
                onChange={(v) => setForm({ ...form, folder_name: v })}
              />
              <div className="sm:col-span-2">
                <Field
                  label="Shop name"
                  required
                  value={form.shop_name}
                  onChange={(v) => setForm({ ...form, shop_name: v })}
                />
              </div>
              <Field
                label="Label name"
                required
                value={form.label_name}
                onChange={(v) => setForm({ ...form, label_name: v })}
              />
              <Field
                label="Bill name"
                required
                value={form.bill_name}
                onChange={(v) => setForm({ ...form, bill_name: v })}
              />
              <Field
                label="Design type"
                type="number"
                required
                value={String(form.design_type)}
                onChange={(v) => setForm({ ...form, design_type: Number(v) || 1 })}
              />
              <Field
                label="Mobile"
                required
                value={form.mobile}
                onChange={(v) => setForm({ ...form, mobile: v })}
              />
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Handled by <RequiredMark />
                </Label>
                <HandledBySelect
                  userId={form.handled_by_user_id}
                  name={form.handled_by}
                  onChange={(next) => setForm({ ...form, ...next })}
                  handlers={handlers}
                  isLoading={handlersLoading}
                />
              </div>
              <Field
                label="Joined on"
                type="date"
                required
                value={form.joined_on}
                onChange={(v) => setForm({ ...form, joined_on: v })}
              />
              <div className="flex items-end gap-3 pb-1">
                <Switch
                  id="active"
                  checked={form.is_active}
                  onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                />
                <Label htmlFor="active">Active</Label>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">
                  Products this shop works with <RequiredMark />
                </Label>
                <ProductMultiSelect
                  products={products}
                  selected={selectedProducts}
                  onChange={setSelectedProducts}
                />
              </div>
              <div className="space-y-4 border-t border-border pt-4 sm:col-span-2">
                <div>
                  <Label className="mb-1.5 block text-xs">
                    Address <RequiredMark />
                  </Label>
                  <Input
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    aria-required
                  />
                </div>
                <LocationPicker
                  required
                  address={form.address}
                  latitude={form.latitude}
                  longitude={form.longitude}
                  onLocationChange={(loc) =>
                    setForm({
                      ...form,
                      latitude: loc.latitude,
                      longitude: loc.longitude,
                      address: loc.address ?? form.address,
                    })
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter className="items-center px-6 pb-6 sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {missingRequired.length > 0
                ? `Still needed: ${missingRequired.join(", ")}`
                : "Every field is required — the shop photo is optional."}
            </p>
            <Button
              onClick={() => save.mutate()}
              disabled={!form.code || missingRequired.length > 0 || save.isPending}
            >
              Save shop
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ShopDetailsDialog
        shop={detailsShop}
        areaName={areaName(detailsShop?.area_id ?? null)}
        productNames={
          (detailsShop &&
            productsByShop
              .get(detailsShop.id)
              ?.map((id) => products.find((p) => p.id === id)?.short_name)
              .filter((n): n is string => !!n)) ??
          []
        }
        onOpenChange={(o) => !o && setDetailsShop(null)}
        onEdit={(shop) => openEdit(shop)}
        onDelete={(shop) => setDeletingShop(shop)}
      />

      <AlertDialog open={!!deletingShop} onOpenChange={(o) => !o && closeDelete()}>
        <AlertDialogContent>
          {deleteConfirmed ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure you want to delete this shop?</AlertDialogTitle>
                <AlertDialogDescription>
                  <span className="font-medium text-foreground">{deletingShop?.shop_name}</span>{" "}
                  will stop appearing in orders, deliveries and every active list. This is the last
                  step — confirm to delete it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={archive.isPending}
                  onClick={() => deletingShop && archive.mutate(deletingShop)}
                >
                  {archive.isPending ? "Deleting…" : "Yes, delete shop"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {deletingShop?.shop_name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This deactivates the shop and hides it from active lists. Its historical orders,
                  deliveries, payments and label orders are kept — nothing is permanently deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                {/* Step one of two — advance the dialog instead of closing it. */}
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    setDeleteConfirmed(true);
                  }}
                >
                  Continue
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      <div className="surface-card overflow-hidden">
        <div className="grid grid-cols-2 items-center gap-2 border-b border-border p-3 sm:flex sm:flex-wrap">
          <div className="col-span-2 flex min-w-0 items-center gap-2 sm:flex-1">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              placeholder="Search shops, area, handler, mobile…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
          </div>
          <ShopAreaFilter value={areaFilter} onChange={setAreaFilter} />
          {/* Only people who can currently be assigned are offered — the
              same active, shop-handling users the form's picker lists. A shop
              still shows the stored name of a handler who has since left, but
              filtering by them is not something you can do any more. */}
          <Select value={handlerFilter} onValueChange={setHandlerFilter}>
            <SelectTrigger className="w-full bg-card sm:w-[190px]">
              <SelectValue placeholder="All handlers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All handlers</SelectItem>
              <SelectItem value={UNASSIGNED}>Not assigned</SelectItem>
              {handlers.map((h) => (
                <SelectItem key={h.id} value={h.id}>
                  {h.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={designFilter} onValueChange={setDesignFilter}>
            <SelectTrigger className="w-full bg-card sm:w-[150px]">
              <SelectValue placeholder="All designs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All designs</SelectItem>
              {designTypes.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: designTypeColor(d) }}
                    />
                    Design {d}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Table from lg up; the same shops as cards below that. */}
        <div className="hidden overflow-x-auto lg:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14 text-right">S.No.</TableHead>
                <SortableHead label="Shop" sortKey="shop_name" sort={sort} onSort={toggleSort} />
                <TableHead>Location</TableHead>
                <SortableHead
                  label="Handled by"
                  sortKey="handled_by"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortableHead
                  label="Joined date"
                  sortKey="joined_on"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortableHead
                  label="Mobile number"
                  sortKey="mobile"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortableHead
                  label="Design"
                  sortKey="design_type"
                  sort={sort}
                  onSort={toggleSort}
                />
                <TableHead className="text-right">View Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    Loading shops…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-14 text-center">
                    <Store className="mx-auto size-8 text-muted-foreground/60" />
                    <p className="mt-3 text-sm text-muted-foreground">
                      No shops yet — add one, or import your workbook.
                    </p>
                  </TableCell>
                </TableRow>
              )}
              {pagination.pageRows.map((shop, i) => (
                <TableRow key={shop.id}>
                  <TableCell className="num text-right text-muted-foreground">
                    {pagination.firstRow + i}
                  </TableCell>
                  <TableCell>
                    <Link
                      to="/shops/$shopId"
                      params={{ shopId: shop.id }}
                      className="font-medium hover:text-primary"
                    >
                      {shop.shop_name}
                    </Link>
                    {shop.label_name && (
                      <p className="text-xs text-muted-foreground">{shop.label_name}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    {shop.latitude != null && shop.longitude != null ? (
                      <a
                        href={googleMapsDirectionsUrl(shop.latitude, shop.longitude)}
                        target="_blank"
                        rel="noreferrer"
                        title="Open directions in Google Maps"
                        className="inline-flex text-muted-foreground hover:text-primary"
                      >
                        <MapPin className="size-4" />
                      </a>
                    ) : (
                      <MapPin className="size-4 text-muted-foreground/30" />
                    )}
                  </TableCell>
                  <TableCell>{shop.handled_by ?? "—"}</TableCell>
                  <TableCell className="num whitespace-nowrap text-sm text-muted-foreground">
                    {dateLabel(shop.joined_on)}
                  </TableCell>
                  <TableCell className="num whitespace-nowrap">{shop.mobile || "—"}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 num">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: designTypeColor(shop.design_type) }}
                      />
                      {shop.design_type}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setDetailsShop(shop)}>
                      View Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <RecordCards className="lg:hidden">
          {isLoading && <p className="p-6 text-center text-muted-foreground">Loading shops…</p>}
          {!isLoading && sorted.length === 0 && (
            <div className="p-10 text-center">
              <Store className="mx-auto size-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm text-muted-foreground">
                No shops yet — add one, or import your workbook.
              </p>
            </div>
          )}
          {pagination.pageRows.map((shop) => (
            <RecordCard
              key={shop.id}
              title={
                <Link
                  to="/shops/$shopId"
                  params={{ shopId: shop.id }}
                  className="hover:text-primary"
                >
                  {shop.shop_name}
                </Link>
              }
              subtitle={shop.label_name ?? undefined}
              badge={
                <span className="num inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: designTypeColor(shop.design_type) }}
                  />
                  Design {shop.design_type}
                </span>
              }
              actions={
                <>
                  <Button variant="outline" size="sm" onClick={() => setDetailsShop(shop)}>
                    View details
                  </Button>
                  {shop.latitude != null && shop.longitude != null && (
                    <Button variant="ghost" size="sm" asChild>
                      <a
                        href={googleMapsDirectionsUrl(shop.latitude, shop.longitude)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <MapPin className="size-4" /> Directions
                      </a>
                    </Button>
                  )}
                </>
              }
            >
              <RecordField label="Handled by">{shop.handled_by ?? "—"}</RecordField>
              <RecordField label="Mobile">
                <span className="num">{shop.mobile || "—"}</span>
              </RecordField>
              <RecordField label="Joined">
                <span className="num">{dateLabel(shop.joined_on)}</span>
              </RecordField>
            </RecordCard>
          ))}
        </RecordCards>

        <DataPagination pagination={pagination} noun="shops" />
      </div>
    </>
  );
}

/** A column header that sorts the table by its column, ascending then descending. */
function SortableHead({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 whitespace-nowrap hover:text-foreground"
      >
        {label}
        <Icon className={cn("size-3.5", active ? "opacity-100" : "opacity-40")} />
      </button>
    </TableHead>
  );
}

function ShopDetailsDialog({
  shop,
  areaName,
  productNames,
  onOpenChange,
  onEdit,
  onDelete,
}: {
  shop: Shop | null;
  areaName: string;
  productNames: string[];
  onOpenChange: (open: boolean) => void;
  onEdit: (shop: Shop) => void;
  onDelete: (shop: Shop) => void;
}) {
  // The signed URL arrives with the shop record, so there's nothing to fetch.
  const imageUrl = shop?.image_url ? fileUrl(shop.image_url) : null;

  return (
    <Dialog open={!!shop} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{shop?.shop_name}</DialogTitle>
        </DialogHeader>
        {shop && (
          <div className="flex-1 space-y-4 overflow-y-auto px-6 pb-2">
            {shop.image_path && imageUrl && (
              <div className="overflow-hidden rounded-md border border-border">
                {isHeicPath(shop.image_path) ? (
                  <a
                    href={imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block p-4 text-center text-sm text-primary underline"
                  >
                    View HEIC original
                  </a>
                ) : (
                  <img
                    src={imageUrl}
                    alt={shop.shop_name}
                    className="max-h-56 w-full object-cover"
                  />
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Detail label="Shop area" value={areaName} />
              <Detail label="Label name" value={shop.label_name ?? "—"} />
              <Detail label="Bill name" value={shop.bill_name ?? "—"} />
              <Detail label="Mobile" value={shop.mobile ?? "—"} />
              <Detail label="Handled by" value={shop.handled_by ?? "—"} />
              <Detail label="Design type" value={String(shop.design_type)} />
              <Detail label="Joined on" value={dateLabel(shop.joined_on)} />
              <Detail label="Status" value={shop.is_active ? "Active" : "Inactive"} />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Address
              </p>
              <p className="text-sm">{shop.address ?? "—"}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Location
              </p>
              {shop.latitude != null && shop.longitude != null ? (
                <Button asChild variant="outline" size="sm">
                  <a
                    href={googleMapsDirectionsUrl(shop.latitude, shop.longitude)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MapPin className="size-3.5" /> Open in Google Maps
                  </a>
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">No saved location.</p>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Products this shop works with
              </p>
              <ProductChips names={productNames} />
            </div>
          </div>
        )}
        <DialogFooter className="px-6 pb-6">
          <Can resource={RESOURCES.shops} action="delete">
            <Button
              variant="outline"
              onClick={() => shop && onDelete(shop)}
              className="text-destructive hover:text-destructive"
            >
              Delete Shop
            </Button>
          </Can>
          <Can resource={RESOURCES.shops} action="update">
            <Button onClick={() => shop && onEdit(shop)}>Edit Details</Button>
          </Can>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function RequiredMark() {
  return (
    <span className="text-destructive" aria-label="required">
      *
    </span>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label} {required && <RequiredMark />}
      </Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-required={required}
      />
    </div>
  );
}
