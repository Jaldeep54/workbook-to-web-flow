import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download, MapPin, Plus, Search, Store } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { LocationPicker } from "@/components/location-picker";
import { ProductMultiSelect, ProductChips } from "@/components/product-multi-select";
import { ShopAreaFilter } from "@/components/filter-bar";
import { ShopAreaSelect } from "@/components/shop-area-select";
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
  shopProductsQuery,
  shopsQuery,
} from "@/lib/queries";
import { isHeicPath } from "@/lib/shop-image";
import { downloadCsv } from "@/lib/export";
import { dateLabel } from "@/lib/format";
import { designTypeColor, googleMapsDirectionsUrl } from "@/lib/domain";
import type { Shop } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/shops/")({
  component: () => (
    <RequirePermission resource={RESOURCES.shops}>
      <ShopsPage />
    </RequirePermission>
  ),
});

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
  joined_on: "",
  is_active: true,
};

/** Base "Handled by" options — grows over time with any distinct value already on file. */
const DEFAULT_HANDLERS = ["Bhavin", "Amisha"];

function HandledBySelect({
  value,
  onChange,
  shops,
}: {
  value: string;
  onChange: (v: string) => void;
  shops: Shop[];
}) {
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState("");

  const options = useMemo(() => {
    const existing = shops.map((s) => s.handled_by).filter((v): v is string => !!v);
    const all = new Set([...DEFAULT_HANDLERS, ...existing]);
    if (value) all.add(value);
    return Array.from(all).sort((a, b) => a.localeCompare(b));
  }, [shops, value]);

  const confirmNewName = () => {
    if (newName.trim()) onChange(newName.trim());
    setAddingNew(false);
    setNewName("");
  };

  if (addingNew) {
    return (
      <div className="flex gap-2">
        <Input
          autoFocus
          placeholder="Person's name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && confirmNewName()}
        />
        <Button type="button" variant="outline" onClick={confirmNewName}>
          Add
        </Button>
      </div>
    );
  }

  return (
    <Select
      value={value || undefined}
      onValueChange={(v) => (v === "__add__" ? setAddingNew(true) : onChange(v))}
    >
      <SelectTrigger>
        <SelectValue placeholder="Select person" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
        <SelectItem value="__add__">+ Add Person…</SelectItem>
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
  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Shop | null>(null);
  const [form, setForm] = useState({ ...emptyShop });
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [detailsShop, setDetailsShop] = useState<Shop | null>(null);
  const [deletingShop, setDeletingShop] = useState<Shop | null>(null);

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shops
      .filter((s) => areaFilter === "all" || s.area_id === areaFilter)
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
  }, [shops, search, areaFilter, areaName]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.shop_name.trim()) throw new Error("Shop name is required");
      if (selectedProducts.length === 0)
        throw new Error("Select at least one product for this shop");

      const payload = {
        ...form,
        code: form.code.trim(),
        shop_name: form.shop_name.trim(),
        joined_on: form.joined_on || null,
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
      setDeletingShop(null);
      setDetailsShop(null);
      void qc.invalidateQueries({ queryKey: ["shops"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const closeForm = () => {
    setOpen(false);
    setEditing(null);
    setForm({ ...emptyShop });
    setSelectedProducts([]);
    setImageFile(null);
    setRemoveImage(false);
  };

  /** New shops get the next sequential code automatically — no longer shown in the UI. */
  const openCreate = async () => {
    setEditing(null);
    setSelectedProducts([]);
    setForm({ ...emptyShop });
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
                  filtered.map((s) => ({
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
            <Can resource={RESOURCES.shops} action="create">
              <Button onClick={() => void openCreate()}>
                <Plus className="size-4" /> New shop
              </Button>
            </Can>
          </>
        }
      />

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : closeForm())}>
        <DialogContent className="flex max-h-[85vh] max-w-lg flex-col overflow-hidden p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>{editing ? "Edit shop" : "New shop"}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 space-y-5 overflow-y-auto px-6 pb-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label className="mb-1.5 block text-xs">Shop area</Label>
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
                value={form.folder_name}
                onChange={(v) => setForm({ ...form, folder_name: v })}
              />
              <div className="sm:col-span-2">
                <Field
                  label="Shop name"
                  value={form.shop_name}
                  onChange={(v) => setForm({ ...form, shop_name: v })}
                />
              </div>
              <Field
                label="Label name"
                value={form.label_name}
                onChange={(v) => setForm({ ...form, label_name: v })}
              />
              <Field
                label="Bill name"
                value={form.bill_name}
                onChange={(v) => setForm({ ...form, bill_name: v })}
              />
              <Field
                label="Design type"
                type="number"
                value={String(form.design_type)}
                onChange={(v) => setForm({ ...form, design_type: Number(v) || 1 })}
              />
              <Field
                label="Mobile"
                value={form.mobile}
                onChange={(v) => setForm({ ...form, mobile: v })}
              />
              <div className="space-y-1.5">
                <Label className="text-xs">Handled by</Label>
                <HandledBySelect
                  value={form.handled_by}
                  onChange={(v) => setForm({ ...form, handled_by: v })}
                  shops={shops}
                />
              </div>
              <Field
                label="Joined on"
                type="date"
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
                <Label className="text-xs">Products this shop works with</Label>
                <ProductMultiSelect
                  products={products}
                  selected={selectedProducts}
                  onChange={setSelectedProducts}
                />
              </div>
              <div className="space-y-4 border-t border-border pt-4 sm:col-span-2">
                <div>
                  <Label className="mb-1.5 block text-xs">Address</Label>
                  <Input
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                  />
                </div>
                <LocationPicker
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
          <DialogFooter className="px-6 pb-6">
            <Button
              onClick={() => save.mutate()}
              disabled={
                !form.code || !form.shop_name || selectedProducts.length === 0 || save.isPending
              }
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

      <AlertDialog open={!!deletingShop} onOpenChange={(o) => !o && setDeletingShop(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deletingShop?.shop_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deactivates the shop and hides it from active lists. Its historical orders,
              deliveries, payments and label orders are kept — nothing is permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deletingShop && archive.mutate(deletingShop)}>
              Delete shop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="surface-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            placeholder="Search shops, area, handler, mobile…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-40 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <ShopAreaFilter value={areaFilter} onChange={setAreaFilter} />
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14 text-right">S.No.</TableHead>
                <TableHead>Shop</TableHead>
                <TableHead>Shop Area</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Handled by</TableHead>
                <TableHead>Design</TableHead>
                <TableHead className="text-right">View Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Loading shops…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-14 text-center">
                    <Store className="mx-auto size-8 text-muted-foreground/60" />
                    <p className="mt-3 text-sm text-muted-foreground">
                      No shops yet — add one, or import your workbook.
                    </p>
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((shop, i) => (
                <TableRow key={shop.id}>
                  <TableCell className="num text-right text-muted-foreground">{i + 1}</TableCell>
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
                  <TableCell className="text-sm text-muted-foreground">
                    {areaName(shop.area_id)}
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
      </div>
    </>
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

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
