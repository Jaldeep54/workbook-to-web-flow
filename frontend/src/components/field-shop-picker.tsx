import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { shopLabel } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type PickableShop = { id: string; shop_name: string; label_name: string | null; code: string };

/**
 * Type-to-search shop picker over a list the caller already holds — Field
 * Operations passes the user's own shops, the dashboards pass a person's
 * shops — so it never needs the full shop directory.
 */
export function FieldShopPicker({
  shops,
  value,
  onChange,
  placeholder = "Select shop",
  allowAll = false,
}: {
  shops: PickableShop[];
  value: string;
  onChange: (shopId: string) => void;
  placeholder?: string;
  /** Offer an "All shops" entry whose value is "all". */
  allowAll?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = shops.find((s) => s.id === value);
  const q = search.trim().toLowerCase();
  const filtered = shops.filter(
    (s) =>
      !q ||
      s.shop_name.toLowerCase().includes(q) ||
      s.code.toLowerCase().includes(q) ||
      (s.label_name ?? "").toLowerCase().includes(q),
  );

  const pick = (id: string) => {
    onChange(id);
    setSearch("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between bg-card font-normal"
        >
          <span className={cn("truncate", !selected && value !== "all" && "text-muted-foreground")}>
            {selected
              ? shopLabel(selected.shop_name, selected.label_name)
              : allowAll && value === "all"
                ? "All shops"
                : placeholder}
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
              {shops.length === 0 ? "No shops here." : "No matching shop."}
            </CommandEmpty>
            <CommandGroup>
              {allowAll && !q && (
                <CommandItem value="all" onSelect={() => pick("all")}>
                  <Check className={cn("size-4", value === "all" ? "opacity-100" : "opacity-0")} />
                  All shops
                </CommandItem>
              )}
              {filtered.map((s) => (
                <CommandItem key={s.id} value={s.id} onSelect={() => pick(s.id)}>
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
