import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { toast } from "sonner";

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
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
                    <Check className={cn("size-4", a.id === value ? "opacity-100" : "opacity-0")} />
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
  );
}
