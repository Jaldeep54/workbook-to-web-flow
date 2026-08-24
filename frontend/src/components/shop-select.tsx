import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";

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
import { shopLabel } from "@/components/filter-bar";
import { shopsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * Type-to-search shop combobox (reuses the Command/Popover pattern from
 * ShopAreaSelect). Pass `areaId` to pre-filter the list to one Shop Area —
 * composes with the search box, which further narrows within that area.
 * Pass `excludeShopIds` to drop shops that aren't valid to pick right now
 * (New Order uses it for shops that already ordered on the chosen date).
 */
export function SearchableShopSelect({
  value,
  onChange,
  areaId,
  excludeShopIds,
  placeholder = "Select shop",
  emptyMessage,
}: {
  value: string;
  onChange: (shopId: string) => void;
  areaId?: string | null;
  excludeShopIds?: ReadonlySet<string>;
  placeholder?: string;
  /** Shown when every shop has been filtered out. */
  emptyMessage?: string;
}) {
  const { data: allShops = [] } = useQuery(shopsQuery);
  const inArea = areaId ? allShops.filter((s) => s.area_id === areaId) : allShops;
  // The current value always stays selectable, so a shop can never vanish from
  // under a selection that has already been made.
  const shops = excludeShopIds
    ? inArea.filter((s) => s.id === value || !excludeShopIds.has(s.id))
    : inArea;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = allShops.find((s) => s.id === value);
  const q = search.trim().toLowerCase();
  const filtered = shops.filter(
    (s) =>
      !q ||
      s.shop_name.toLowerCase().includes(q) ||
      s.code.toLowerCase().includes(q) ||
      (s.label_name ?? "").toLowerCase().includes(q),
  );

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
            {selected ? shopLabel(selected.shop_name, selected.label_name) : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search shop or code…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty className="px-3 py-4 text-sm text-muted-foreground">
              {shops.length === 0
                ? (emptyMessage ?? (areaId ? "No shops in this area." : "No shops available."))
                : "No matching shop."}
            </CommandEmpty>
            <CommandGroup>
              {filtered.map((s) => (
                <CommandItem
                  key={s.id}
                  value={s.id}
                  onSelect={() => {
                    onChange(s.id);
                    setSearch("");
                    setOpen(false);
                  }}
                >
                  <Check className={cn("size-4", s.id === value ? "opacity-100" : "opacity-0")} />
                  {shopLabel(s.shop_name, s.label_name)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
