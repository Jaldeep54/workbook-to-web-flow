import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, LocateFixed } from "lucide-react";
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
import { shopAreasQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { ShopArea } from "@/lib/domain";

/**
 * Shop Area picker for the shop create/edit form — a search-and-select over
 * the centrally managed area list, and nothing more.
 *
 * Areas are deliberately *not* creatable from here. Typing a new one while
 * adding a shop is what produced "adajan" alongside "Adajan"; they are added
 * once in Shops → Shop areas and picked from that list everywhere else.
 */
export function ShopAreaSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (areaId: string, areaName: string) => void;
}) {
  const { data: areas = [] } = useQuery(shopAreasQuery);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = areas.find((a) => a.id === value);
  const trimmedSearch = search.trim();

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
                {areas.length === 0
                  ? "No areas set up yet — add them in Shops → Shop areas."
                  : `No area matches "${trimmedSearch}". Add it in Shops → Shop areas.`}
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
          </Command>
        </PopoverContent>
      </Popover>
      <DetectAreaButton areas={areas} onChange={onChange} />
    </div>
  );
}

/**
 * Picks the area from where the device actually is — the shop is usually
 * being added while standing in front of it. The browser asks for location
 * permission on the first click.
 *
 * It only ever *selects* an existing area. If the detected neighbourhood
 * isn't on the list it says so rather than creating it, so a stray GPS
 * reading can't quietly invent a new area.
 */
function DetectAreaButton({
  areas,
  onChange,
}: {
  areas: ShopArea[];
  onChange: (id: string, name: string) => void;
}) {
  const mapsUnavailable = useMapsUnavailableReason();
  const [detecting, setDetecting] = useState(false);

  const detect = async () => {
    setDetecting(true);
    try {
      const pos = await getCurrentPosition();
      const { areaName } = await reverseGeocodeArea(pos.latitude, pos.longitude);
      if (!areaName) {
        toast.error("Could not work out an area name for your location — pick one instead");
        return;
      }
      const match = areas.find((a) => a.name.toLowerCase() === areaName.toLowerCase());
      if (!match) {
        toast.error(`You seem to be in "${areaName}", which isn't in the area list yet`, {
          description: "Add it in Shops → Shop areas, then pick it here.",
        });
        return;
      }
      onChange(match.id, match.name);
      toast.success(`Area detected: ${match.name}`);
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
