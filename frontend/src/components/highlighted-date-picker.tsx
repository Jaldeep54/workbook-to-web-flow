import { CalendarIcon, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dateLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Local-date-safe ISO conversion — mirrors the pattern already used on Orders/Delivery Sheet. */
function toISODate(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/**
 * Single-date picker (wraps ui/calendar.tsx) that marks a set of dates with a
 * small dot so it's clear at a glance which days have data — e.g. dates with
 * orders on Orders, or deliveries due on the Delivery Sheet.
 *
 * Pass the page's selected `month` and the calendar opens on it: picking
 * "March 2026" in the month dropdown and then opening this should show March,
 * not whatever month today happens to be in.
 */
export function HighlightedDatePicker({
  value,
  onChange,
  highlightedDates = [],
  placeholder = "Any date",
  allowClear = true,
  month,
  className,
}: {
  value: string | null;
  onChange: (date: string | null) => void;
  /** ISO dates (YYYY-MM-DD) to mark with a dot in the calendar. */
  highlightedDates?: string[];
  placeholder?: string;
  allowClear?: boolean;
  /** Month key (YYYY-MM-01) the calendar opens on when no date is selected. */
  month?: string;
  className?: string;
}) {
  const highlighted = highlightedDates.map((d) => new Date(`${d}T00:00:00`));
  const selected = value ? new Date(`${value}T00:00:00`) : undefined;
  // A chosen date wins; otherwise the page's month. The popover content
  // mounts fresh on every open, so this is re-read each time it opens.
  const openOn = selected ?? (month ? new Date(`${month.slice(0, 7)}-01T00:00:00`) : undefined);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("w-full justify-start bg-card font-normal sm:w-auto", className)}
        >
          <CalendarIcon className="size-4" />
          {value ? dateLabel(value) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={openOn}
          onSelect={(d) => d && onChange(toISODate(d))}
          modifiers={{ highlighted }}
          modifiersClassNames={{
            highlighted:
              "relative after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-primary",
          }}
          initialFocus
          className="pointer-events-auto p-3"
        />
        {allowClear && value && (
          <Button
            variant="ghost"
            size="sm"
            className="m-2 mt-0 w-[calc(100%-1rem)]"
            onClick={() => onChange(null)}
          >
            <X className="size-3.5" /> Clear date
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
