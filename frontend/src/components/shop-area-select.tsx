import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, LocateFixed, Plus } from "lucide-react";
import { toast } from "sonner";

import { useMapsUnavailableReason } from "@/components/map-unavailable";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { getCurrentPosition, reverseGeocodeArea } from "@/lib/geocode";
import { shopAreasQuery, upsertShopArea } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Searchable Shop Area picker with an inline "Add New Area" — used in the shop create/edit form. */
export function ShopAreaSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (areaId: string, areaName: string) => void;
}) {
  const qc = useQueryClient();
  const { data: areas = [] } = useQuery(shopAreasQuery);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const selected = areas.find((a) => a.id === value);
  const trimmedSearch = search.trim();
  const exactMatch = areas.some((a) => a.name.toLowerCase() === trimmedSearch.toLowerCase());

  const createArea = async () => {
    if (!trimmedSearch) return;
    setCreating(true);
    try {
      const area = await upsertShopArea(trimmedSearch);
      await qc.invalidateQueries({ queryKey: ["shop_areas"] });
      onChange(area.id, area.name);
      setSearch("");
      setOpen(false);
      toast.success(`Area "${area.name}" added`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create area");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="min-w-0 flex-1 justify-between font-normal"
          >
            <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected?.name ?? "Select area"}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search area…" value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty className="px-3 py-4 text-sm text-muted-foreground">
                {trimmedSearch ? "No matching area." : "No areas yet."}
              </CommandEmpty>
              <CommandGroup>
                {areas
                  .filter((a) => a.name.toLowerCase().includes(trimmedSearch.toLowerCase()))
                  .map((a) => (
                    <CommandItem
                      key={a.id}
                      value={a.id}
                      onSelect={() => {
                        onChange(a.id, a.name);
                        setSearch("");
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn("size-4", a.id === value ? "opacity-100" : "opacity-0")}
                      />
                      {a.name}
                    </CommandItem>
                  ))}
              </CommandGroup>
            </CommandList>
            {trimmedSearch && !exactMatch && (
              <div className="border-t border-border p-1">
                <button
                  type="button"
                  onClick={() => void createArea()}
                  disabled={creating}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-primary hover:bg-accent disabled:opacity-50"
                >
                  <Plus className="size-4" />
                  {creating ? "Adding…" : `Add New Area "${trimmedSearch}"`}
                </button>
              </div>
            )}
          </Command>
        </PopoverContent>
      </Popover>
      <DetectAreaButton onChange={onChange} />
    </div>
  );
}

/**
 * Fills the area in from where the device actually is — the shop is usually
 * being added while standing in front of it. The browser asks for location
 * permission on the first click; declining it just shows the reason and
 * leaves the picker alone.
 *
 * A detected name that matches an existing area (case-insensitively) selects
 * that area rather than creating a near-duplicate; anything new is added to
 * the area list, which is what `upsertShopArea` already does for a typed name.
 */
function DetectAreaButton({ onChange }: { onChange: (id: string, name: string) => void }) {
  const qc = useQueryClient();
  const mapsUnavailable = useMapsUnavailableReason();
  const [detecting, setDetecting] = useState(false);

  const detect = async () => {
    setDetecting(true);
    try {
      const pos = await getCurrentPosition();
      const { areaName } = await reverseGeocodeArea(pos.latitude, pos.longitude);
      if (!areaName) {
        toast.error("Could not work out an area name for your location — pick or type one instead");
        return;
      }
      const area = await upsertShopArea(areaName);
      await qc.invalidateQueries({ queryKey: ["shop_areas"] });
      onChange(area.id, area.name);
      toast.success(`Area detected: ${area.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not detect the area");
    } finally {
      setDetecting(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => void detect()}
      disabled={detecting || !!mapsUnavailable}
      title={mapsUnavailable ?? "Detect the area from your current location"}
    >
      {detecting ? <Loader2 className="size-4 animate-spin" /> : <LocateFixed className="size-4" />}
      Detect
    </Button>
  );
}
