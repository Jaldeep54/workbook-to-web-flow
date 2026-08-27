import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, MapPin, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { RESOURCES, usePermissions } from "@/hooks/usePermissions";
import { shopAreasQuery } from "@/lib/queries";
import { shopAreasApi } from "@/services/klinzo.service";
import { num } from "@/lib/format";
import type { ShopArea } from "@/lib/domain";

/** "Delete the area and leave its shops without one" — the deliberate opt-out. */
const UNASSIGN = "__unassign__";

/**
 * The one place Shop Areas are created, renamed and removed.
 *
 * Areas used to be typed in while adding a shop, which is how "adajan" and
 * "Adajan" ended up as separate places. They are managed centrally here
 * instead, and every area picker in the app just reads that list.
 */
export function ShopAreasDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const { data: areas = [], isLoading } = useQuery(shopAreasQuery);

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deleting, setDeleting] = useState<ShopArea | null>(null);
  /** For an area still in use: the area to move its shops to, or UNASSIGN. */
  const [deleteTarget, setDeleteTarget] = useState("");

  const canCreate = can(RESOURCES.shopAreas, "create");
  const canUpdate = can(RESOURCES.shopAreas, "update");
  const canDelete = can(RESOURCES.shopAreas, "delete");

  // An area's name and membership show up on every shop row and in every area
  // filter, so both caches are refreshed after any change here.
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["shop_areas"] }),
      qc.invalidateQueries({ queryKey: ["shops"] }),
    ]);

  const create = useMutation({
    mutationFn: (name: string) => shopAreasApi.upsert(name),
    onSuccess: async (area) => {
      toast.success(`Area "${area.name}" added`);
      setNewName("");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => shopAreasApi.update(id, name),
    onSuccess: async (area) => {
      toast.success(`Area renamed to "${area.name}"`);
      setEditingId(null);
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (area: ShopArea) =>
      shopAreasApi.remove(
        area.id,
        deleteTarget === UNASSIGN
          ? { force: true }
          : deleteTarget
            ? { reassignTo: deleteTarget }
            : undefined,
      ),
    onSuccess: async (result) => {
      toast.success(result.message);
      closeDelete();
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const closeDelete = () => {
    setDeleting(null);
    setDeleteTarget("");
  };

  const submitNew = () => {
    const name = newName.trim();
    if (!name) return;
    // The API find-or-creates, so a duplicate would silently "succeed" and
    // look like it added something. Say what actually happened instead.
    if (areas.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
      toast.error(`"${name}" already exists`);
      return;
    }
    create.mutate(name);
  };

  const submitRename = () => {
    const name = editingName.trim();
    if (!editingId || !name) return;
    if (name === areas.find((a) => a.id === editingId)?.name) {
      setEditingId(null);
      return;
    }
    rename.mutate({ id: editingId, name });
  };

  const otherAreas = areas.filter((a) => a.id !== deleting?.id);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] max-w-lg flex-col overflow-hidden p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>Shop areas</DialogTitle>
            <DialogDescription>
              The area list every shop, filter and report reads from. Rename one and it updates
              everywhere it appears.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 pb-6">
            {canCreate && (
              <div className="mb-4 space-y-1.5">
                <Label className="text-xs">Add an area</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Area name, e.g. Mota Varachha"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        submitNew();
                      }
                    }}
                    maxLength={120}
                  />
                  <Button onClick={submitNew} disabled={!newName.trim() || create.isPending}>
                    <Plus className="size-4" /> Add
                  </Button>
                </div>
              </div>
            )}

            <div className="overflow-hidden rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Area</TableHead>
                    <TableHead className="w-24 text-right">Shops</TableHead>
                    {(canUpdate || canDelete) && <TableHead className="w-24" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow>
                      <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                        Loading areas…
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && areas.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="py-10 text-center">
                        <MapPin className="mx-auto size-7 text-muted-foreground/60" />
                        <p className="mt-2 text-sm text-muted-foreground">
                          {canCreate
                            ? "No areas yet — add the first one above."
                            : "No areas have been set up yet."}
                        </p>
                      </TableCell>
                    </TableRow>
                  )}
                  {areas.map((area) => (
                    <TableRow key={area.id}>
                      <TableCell>
                        {editingId === area.id ? (
                          <Input
                            autoFocus
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                submitRename();
                              }
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            maxLength={120}
                            className="h-8"
                          />
                        ) : (
                          <span className="font-medium">{area.name}</span>
                        )}
                      </TableCell>
                      <TableCell className="num text-right text-muted-foreground">
                        {num(area.shop_count)}
                      </TableCell>
                      {(canUpdate || canDelete) && (
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            {editingId === area.id ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8"
                                  aria-label="Save name"
                                  disabled={!editingName.trim() || rename.isPending}
                                  onClick={submitRename}
                                >
                                  <Check className="size-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8"
                                  aria-label="Cancel rename"
                                  onClick={() => setEditingId(null)}
                                >
                                  <X className="size-4" />
                                </Button>
                              </>
                            ) : (
                              <>
                                {canUpdate && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8"
                                    aria-label={`Rename ${area.name}`}
                                    onClick={() => {
                                      setEditingId(area.id);
                                      setEditingName(area.name);
                                    }}
                                  >
                                    <Pencil className="size-4" />
                                  </Button>
                                )}
                                {canDelete && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8 text-destructive hover:text-destructive"
                                    aria-label={`Delete ${area.name}`}
                                    onClick={() => setDeleting(area)}
                                  >
                                    <Trash2 className="size-4" />
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {!canCreate && !canUpdate && !canDelete && (
              <p className="mt-3 text-xs text-muted-foreground">
                You can select these areas on a shop, but changing the list needs the Shop Areas
                permission.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && closeDelete()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && deleting.shop_count > 0
                ? `${num(deleting.shop_count)} shop${deleting.shop_count === 1 ? " is" : "s are"} in this area. Choose where ${deleting.shop_count === 1 ? "it goes" : "they go"} before it can be deleted.`
                : "This area isn't used by any shop, so nothing else changes."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {deleting && deleting.shop_count > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Move these shops to</Label>
              <Select value={deleteTarget} onValueChange={setDeleteTarget}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an area…" />
                </SelectTrigger>
                <SelectContent>
                  {otherAreas.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={UNASSIGN}>Leave them without an area</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {/* Not an AlertDialogAction: the dialog must stay open if the
                delete is refused, so the user can pick a different answer. */}
            <Button
              variant="destructive"
              disabled={
                remove.isPending || (!!deleting && deleting.shop_count > 0 && !deleteTarget)
              }
              onClick={() => deleting && remove.mutate(deleting)}
            >
              {remove.isPending ? "Deleting…" : "Delete area"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
