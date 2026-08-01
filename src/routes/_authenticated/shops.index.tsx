import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download, Plus, Search, Store } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { ProductMultiSelect } from "@/components/product-multi-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { fetchNextShopCode, productsQuery, shopProductsQuery, shopsQuery } from "@/lib/queries";
import { downloadCsv } from "@/lib/export";
import { dateLabel } from "@/lib/format";
import type { Shop } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/shops/")({
  head: () => ({
    meta: [
      { title: "Shops — Klinzo Operations" },
      { name: "description", content: "Every Klinzo shop with contact details, handler and design type." },
      { property: "og:title", content: "Shops — Klinzo Operations" },
      { property: "og:description", content: "Manage the full Klinzo shop directory." },
    ],
  }),
  component: ShopsPage,
});

const emptyShop = {
  code: "",
  folder_name: "",
  shop_name: "",
  label_name: "",
  design_type: 1,
  address: "",
  mobile: "",
  handled_by: "",
  joined_on: "",
  is_active: true,
};

function ShopsPage() {
  const qc = useQueryClient();
  const { data: shops = [], isLoading } = useQuery(shopsQuery);
  const { data: products = [] } = useQuery(productsQuery);
  const { data: shopProducts = [] } = useQuery(shopProductsQuery);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Shop | null>(null);
  const [form, setForm] = useState({ ...emptyShop });
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);

  const productsByShop = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const link of shopProducts) {
      map.set(link.shop_id, [...(map.get(link.shop_id) ?? []), link.product_id]);
    }
    return map;
  }, [shopProducts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return shops;
    return shops.filter((s) =>
      [s.code, s.shop_name, s.label_name, s.handled_by, s.mobile, s.address]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [shops, search]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.shop_name.trim()) throw new Error("Shop name is required");
      if (selectedProducts.length === 0) throw new Error("Select at least one product for this shop");

      const payload = {
        ...form,
        code: form.code.trim(),
        shop_name: form.shop_name.trim(),
        joined_on: form.joined_on || null,
        design_type: Number(form.design_type) || 1,
      };

      let shopId = editing?.id;
      if (editing) {
        const { error } = await supabase.from("shops").update(payload).eq("id", editing.id);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await supabase.from("shops").insert(payload).select("id").single();
        if (error) throw new Error(error.message);
        shopId = (data as { id: string }).id;
      }
      if (!shopId) throw new Error("Shop could not be saved");

      const existing = productsByShop.get(shopId) ?? [];
      const toAdd = selectedProducts.filter((id) => !existing.includes(id));
      const toRemove = existing.filter((id) => !selectedProducts.includes(id));

      if (toAdd.length) {
        const { error } = await supabase
          .from("shop_products" as never)
          .insert(toAdd.map((product_id) => ({ shop_id: shopId, product_id })) as never);
        if (error) throw new Error(error.message);
      }
      if (toRemove.length) {
        const { error } = await supabase
          .from("shop_products" as never)
          .delete()
          .eq("shop_id", shopId)
          .in("product_id", toRemove);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Shop updated" : "Shop added");
      setOpen(false);
      setEditing(null);
      setForm({ ...emptyShop });
      setSelectedProducts([]);
      void qc.invalidateQueries({ queryKey: ["shops"] });
      void qc.invalidateQueries({ queryKey: ["shop_products"] });
      void qc.invalidateQueries({ queryKey: ["sku_opportunity"] });
      void qc.invalidateQueries({ queryKey: ["label_stock"] });
      void qc.invalidateQueries({ queryKey: ["label_stock_summary"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** New shops get the next sequential code automatically. */
  const openCreate = async () => {
    setEditing(null);
    setSelectedProducts([]);
    setForm({ ...emptyShop });
    setOpen(true);
    try {
      const code = await fetchNextShopCode();
      setForm((f) => ({ ...f, code }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate a shop code");
    }
  };

  const openEdit = (shop: Shop) => {
    setEditing(shop);
    setSelectedProducts(productsByShop.get(shop.id) ?? []);
    setForm({
      code: shop.code,
      folder_name: shop.folder_name ?? "",
      shop_name: shop.shop_name,
      label_name: shop.label_name ?? "",
      design_type: shop.design_type,
      address: shop.address ?? "",
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
            <Dialog
              open={open}
              onOpenChange={(o) => {
                setOpen(o);
                if (!o) {
                  setEditing(null);
                  setForm({ ...emptyShop });
                  setSelectedProducts([]);
                }
              }}
            >
              <Button onClick={() => void openCreate()}>
                <Plus className="size-4" /> New shop
              </Button>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>{editing ? "Edit shop" : "New shop"}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Shop code (auto)</Label>
                    <Input value={form.code} readOnly className="num bg-muted/60" />
                  </div>
                  <Field label="Folder name" value={form.folder_name} onChange={(v) => setForm({ ...form, folder_name: v })} />
                  <div className="sm:col-span-2">
                    <Field label="Shop name" value={form.shop_name} onChange={(v) => setForm({ ...form, shop_name: v })} />
                  </div>
                  <Field label="Label name" value={form.label_name} onChange={(v) => setForm({ ...form, label_name: v })} />
                  <Field
                    label="Design type"
                    type="number"
                    value={String(form.design_type)}
                    onChange={(v) => setForm({ ...form, design_type: Number(v) || 1 })}
                  />
                  <Field label="Mobile" value={form.mobile} onChange={(v) => setForm({ ...form, mobile: v })} />
                  <Field label="Handled by" value={form.handled_by} onChange={(v) => setForm({ ...form, handled_by: v })} />
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
                  <div className="sm:col-span-2">
                    <Field label="Address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs">Products this shop works with</Label>
                    <ProductMultiSelect
                      products={products}
                      selected={selectedProducts}
                      onChange={setSelectedProducts}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={() => save.mutate()}
                    disabled={!form.code || !form.shop_name || selectedProducts.length === 0 || save.isPending}
                  >
                    Save shop
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <div className="surface-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <Search className="size-4 text-muted-foreground" />
          <Input
            placeholder="Search shops, code, handler, mobile…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Shop</TableHead>
                <TableHead>Handled by</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Design</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
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
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-14 text-center">
                    <Store className="mx-auto size-8 text-muted-foreground/60" />
                    <p className="mt-3 text-sm text-muted-foreground">
                      No shops yet — add one, or import your workbook.
                    </p>
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((shop) => (
                <TableRow key={shop.id}>
                  <TableCell className="num font-medium">{shop.code}</TableCell>
                  <TableCell>
                    <Link to="/shops/$shopId" params={{ shopId: shop.id }} className="font-medium hover:text-primary">
                      {shop.shop_name}
                    </Link>
                    {shop.label_name && <p className="text-xs text-muted-foreground">{shop.label_name}</p>}
                  </TableCell>
                  <TableCell>{shop.handled_by ?? "—"}</TableCell>
                  <TableCell className="num">{shop.mobile ?? "—"}</TableCell>
                  <TableCell className="num">{shop.design_type}</TableCell>
                  <TableCell>{dateLabel(shop.joined_on)}</TableCell>
                  <TableCell>
                    <Badge variant={shop.is_active ? "default" : "secondary"}>
                      {shop.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(shop)}>
                      Edit
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