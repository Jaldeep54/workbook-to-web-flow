import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The shared search box for record tables.
 *
 * Searching narrows the rows already on screen rather than asking the server
 * again: the list is month-scoped before it arrives, so matching happens as
 * the user types with no round trip and no debounce to tune.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div className={cn("relative w-full sm:w-[220px]", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onChange("")}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className="bg-card pl-8 pr-8"
      />
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Clear search"
          className="absolute right-0.5 top-1/2 size-8 -translate-y-1/2 text-muted-foreground"
          onClick={() => onChange("")}
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}

/**
 * Case- and punctuation-insensitive "does any of these fields contain the
 * search text" — the one matcher every table's search uses, so a search
 * behaves the same wherever it appears.
 */
export function matchesSearch(
  search: string,
  ...fields: Array<string | number | null | undefined>
) {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) =>
    String(field ?? "")
      .toLowerCase()
      .includes(needle),
  );
}
