import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Product } from "@/lib/domain";

/** Multi-select of the products a shop works with. */
export function ProductMultiSelect({
  products,
  selected,
  onChange,
}: {
  products: Product[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  const chosen = products.filter((p) => selected.includes(p.id));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between font-normal">
          <span className="truncate">
            {chosen.length === 0
              ? "Select products"
              : `${chosen.length} of ${products.length} selected`}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="pointer-events-auto w-64 p-2" align="start">
        <div className="flex flex-col gap-0.5">
          {products.map((p) => {
            const active = selected.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                  active && "font-medium",
                )}
              >
                <Checkbox checked={active} className="pointer-events-none" />
                <span className="flex-1 truncate">{p.short_name}</span>
                {active && <Check className="size-3.5 text-primary" />}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between border-t border-border pt-2">
          <Button variant="ghost" size="sm" onClick={() => onChange(products.map((p) => p.id))}>
            Select all
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onChange([])}>
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ProductChips({ names }: { names: string[] }) {
  if (names.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {names.map((n) => (
        <Badge key={n} variant="secondary" className="font-normal">
          {n}
        </Badge>
      ))}
    </div>
  );
}
